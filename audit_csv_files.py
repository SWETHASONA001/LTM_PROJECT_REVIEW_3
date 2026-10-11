
import pandas as pd
from pathlib import Path

files = [
    "data/raw/wind/la-haute-borne-data-2017-2020.csv",
    "data/raw/electrolyzer/combined_wind_experiments.csv",
    "data/raw/electrolyzer/combined_historical_wind_experiments.csv",
    "data/raw/hydro-electrolyzer/combined_simulated_tidal_experiments.csv",
]

report = []

for file in files:
    path = Path(file)
    report.append("\n" + "=" * 80)
    report.append(f"FILE: {file}")

    if not path.exists():
        report.append("STATUS: FILE NOT FOUND")
        continue

    try:
        separator = ";" if "la-haute-borne" in file else ","
        df = pd.read_csv(path, sep=separator, low_memory=False)

        report.append(f"Shape: {df.shape}")
        report.append(f"Columns: {df.columns.tolist()}")
        report.append("\nData types:\n" + df.dtypes.to_string())
        report.append("\nFirst 2 rows:\n" + df.head(2).to_string(index=False))
        report.append(f"\nMissing cells: {int(df.isna().sum().sum())}")
        report.append(f"Exact duplicate rows: {int(df.duplicated().sum())}")

        # Check likely timestamp and experiment fields
        for col in df.columns:
            name = str(col).lower()
            if any(word in name for word in ["date", "time", "timestamp", "experiment"]):
                report.append(f"\nField summary: {col}")
                report.append(f"Unique values: {df[col].nunique(dropna=True)}")
                report.append(f"Sample values: {df[col].dropna().head(5).tolist()}")

    except Exception as exc:
        report.append(f"ERROR: {type(exc).__name__}: {exc}")

output = Path("reports/csv_audit_summary.txt")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text("\n".join(report), encoding="utf-8")

print("\n".join(report))
print(f"\nReport saved to: {output.resolve()}")
