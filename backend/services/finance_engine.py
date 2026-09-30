import uuid

import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from models.financial_observation import FinancialObservation

TARGET_METRICS = ["Total Revenue", "Operating Income", "Net Income"]

METRIC_NAME_MAP = {
    "Total Revenue": "total_revenue",
    "Operating Income": "operating_income",
    "Net Income": "net_income",
}


def fetch_company_financials(ticker: str) -> dict:
    try:
        yf_ticker = yf.Ticker(ticker)
        financials = yf_ticker.financials
        if financials is None or financials.empty:
            return {}

        result: dict = {}
        for metric in TARGET_METRICS:
            if metric not in financials.index:
                continue
            series = financials.loc[metric]
            period_values = {}
            for period_end, value in series.items():
                if pd.isna(value):
                    continue
                period_values[period_end.strftime("%Y-%m-%d")] = float(value)
            if period_values:
                result[metric] = period_values
        return result
    except Exception as exc:
        print(f"[fetch_company_financials] FAILED for ticker {ticker!r}: {exc}")
        return {}


def normalize_financials(
    raw: dict, ticker: str, session_id: uuid.UUID, company_id: uuid.UUID, db: Session
) -> list[FinancialObservation]:
    rows = []
    for yf_metric, period_values in raw.items():
        metric_name = METRIC_NAME_MAP.get(yf_metric, yf_metric.lower().replace(" ", "_"))
        for period_end_str, value in period_values.items():
            year = period_end_str.split("-")[0]
            period_label = f"FY{year}"
            value_millions = round(value / 1_000_000, 2)
            rows.append(
                FinancialObservation(
                    session_id=session_id,
                    company_id=company_id,
                    metric=metric_name,
                    value=value_millions,
                    unit="USD_millions",
                    period=period_label,
                    observation_type="REPORTED",
                    source="yfinance",
                    calc_inputs=None,
                )
            )

    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def calculate_revenue_growth(
    observations: list[FinancialObservation],
) -> list[FinancialObservation]:
    revenue_obs = sorted(
        (o for o in observations if o.metric == "total_revenue" and o.observation_type == "REPORTED"),
        key=lambda o: o.period,
    )

    results = []
    for i in range(1, len(revenue_obs)):
        prior = revenue_obs[i - 1]
        current = revenue_obs[i]
        if prior.value == 0:
            continue

        growth = round((current.value - prior.value) / prior.value * 100, 2)
        results.append(
            FinancialObservation(
                session_id=current.session_id,
                company_id=current.company_id,
                metric="revenue_growth_yoy",
                value=growth,
                unit="percent",
                period=current.period,
                observation_type="CALCULATED",
                source="calculated",
                calc_inputs={
                    "prior_period": prior.period,
                    "prior_value_musd": prior.value,
                    "current_period": current.period,
                    "current_value_musd": current.value,
                },
            )
        )
    return results


def calculate_operating_margin(
    observations: list[FinancialObservation],
) -> list[FinancialObservation]:
    revenue_by_period = {
        o.period: o
        for o in observations
        if o.metric == "total_revenue" and o.observation_type == "REPORTED"
    }
    operating_income_by_period = {
        o.period: o
        for o in observations
        if o.metric == "operating_income" and o.observation_type == "REPORTED"
    }

    results = []
    for period, revenue_obs in revenue_by_period.items():
        operating_income_obs = operating_income_by_period.get(period)
        if operating_income_obs is None or revenue_obs.value == 0:
            continue

        margin = round(operating_income_obs.value / revenue_obs.value * 100, 2)
        results.append(
            FinancialObservation(
                session_id=revenue_obs.session_id,
                company_id=revenue_obs.company_id,
                metric="operating_margin",
                value=margin,
                unit="percent",
                period=period,
                observation_type="CALCULATED",
                source="calculated",
                calc_inputs={
                    "period": period,
                    "operating_income_musd": operating_income_obs.value,
                    "revenue_musd": revenue_obs.value,
                },
            )
        )
    return results


async def run_finance_engine(
    ticker: str, session_id: uuid.UUID, company_id: uuid.UUID, db: Session
) -> list[FinancialObservation]:
    raw = fetch_company_financials(ticker)
    reported = normalize_financials(raw, ticker, session_id, company_id, db)

    growth = calculate_revenue_growth(reported)
    margin = calculate_operating_margin(reported)
    calculated = growth + margin

    db.add_all(calculated)
    db.commit()
    for row in calculated:
        db.refresh(row)

    return reported + calculated
