
import pandas as pd
from pathlib import Path

FILES = {
    "wind_scada": ("data/raw/wind/la-haute-borne-data-2017-2020.csv", ";"),
    "wind_electrolyzer": ("data/raw/electrolyzer/combined_wind_experiments.csv", ","),
    "historical_electrolyzer": (
        "data/raw/electrolyzer/combined_historical_wind_experiments.csv", ","
    ),
    "tidal_electrolyzer": (
        "data/raw/hydro-electrolyzer/combined_simulated_tidal_experiments.csv", ","
    ),
}

report = []

for name, (filename, separator) in FILES.items():
    path = Path(filename)
    report.append(f"\n{'=' * 65}\nDATASET: {name}\nFILE: {filename}")

    if not path.exists():
        report.append("FILE NOT FOUND — check the path.")
        continue

    df = pd.read_csv(path, sep=separator, low_memory=False)
    report.append(f"Shape: {df.shape}")
    report.append(f"Missing cells: {int(df.isna().sum().sum())}")
    report.append(
        f"Completely empty columns: "
        f"{df.columns[df.isna().all()].tolist()}"
    )
    report.append(f"Exact duplicate rows: {int(df.duplicated().sum())}")

    timestamp_col = "Date_time" if name == "wind_scada" else "Unnamed: 0"

    if timestamp_col in df.columns:
        ts = pd.to_datetime(df[timestamp_col], errors="coerce", utc=True)
        report.append(f"Invalid timestamps: {int(ts.isna().sum())}")
        report.append(f"Time range: {ts.min()} to {ts.max()}")

    if name == "wind_scada":
        keys = ["Wind_turbine_name", "Date_time"]
        if all(c in df.columns for c in keys):
            report.append(
                f"Rows with duplicate turbine/timestamp keys: "
                f"{int(df.duplicated(keys, keep=False).sum())}"
            )

        for col in ["P_avg", "Ws_avg", "Wa_avg"]:
            if col in df.columns:
                values = pd.to_numeric(df[col], errors="coerce")
                report.append(
                    f"{col}: missing={int(values.isna().sum())}, "
                    f"min={values.min()}, median={values.median()}, "
                    f"max={values.max()}"
                )

    if "Experiment" in df.columns:
        report.append(
            "Experiment counts:\n" +
            df["Experiment"].value_counts(dropna=False).to_string()
        )

    for col in ["Efficiency (kWh/kg)", "tidal-500kW-RM1 (kW)"]:
        if col in df.columns:
            values = pd.to_numeric(df[col], errors="coerce")
            report.append(
                f"{col}: min={values.min()}, median={values.median()}, "
                f"max={values.max()}"
            )

output = Path("reports/data_quality_audit.txt")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text("\n".join(report), encoding="utf-8")

print("\n".join(report))
print(f"\nReport saved to: {output.resolve()}")
