
from pathlib import Path
import pandas as pd
import xarray as xr

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
REPORT = ROOT / "reports" / "dataset_audit.txt"
REPORT.parent.mkdir(parents=True, exist_ok=True)

def log(message=""):
    print(message)
    report_lines.append(str(message))

report_lines = []

csv_files = [
    (
        RAW / "wind" / "la-haute-borne-data-2017-2020.csv",
        ";",
    ),
    (
        RAW / "electrolyzer" / "combined_wind_experiments.csv",
        ",",
    ),
    (
        RAW / "electrolyzer" / "combined_historical_wind_experiments.csv",
        ",",
    ),
    (
        RAW / "hydro-electrolyzer"
        / "combined_simulated_tidal_experiments.csv",
        ",",
    ),
]

for path, separator in csv_files:
    log("\n" + "=" * 85)
    log(f"CSV: {path.relative_to(ROOT)}")

    if not path.exists():
        log("STATUS: FILE NOT FOUND")
        continue

    try:
        df = pd.read_csv(
            path,
            sep=separator,
            low_memory=False,
            nrows=None,
        )

        log(f"Rows: {len(df):,}")
        log(f"Columns: {len(df.columns)}")
        log("\nColumn names:")
        for column in df.columns:
            log(f"  {column!r}")

        log("\nData types:")
        log(df.dtypes.to_string())

        log("\nFirst 5 rows:")
        log(df.head().to_string(max_cols=12))

        log("\nMissing values (highest first):")
        missing = df.isna().sum().sort_values(ascending=False)
        log(missing[missing > 0].head(30).to_string())

        log("\nNumeric summary:")
        log(df.describe().round(3).to_string())

        log("\nPotential timestamp columns:")
        for column in df.columns:
            name = str(column).lower()
            if any(word in name for word in
                   ["time", "date", "timestamp"]):
                log(f"  {column!r}")

        log("\nPotential experiment/site identifier columns:")
        for column in df.columns:
            name = str(column).lower()
            if any(word in name for word in
                   ["experiment", "turbine", "site", "station", "id"]):
                log(f"  {column!r}")
                log(f"    Unique values: {df[column].nunique(dropna=True)}")
                log(f"    Examples: {df[column].dropna().astype(str).unique()[:8].tolist()}")

        if "Wind_turbine_name" in df.columns and "Date_time" in df.columns:
            timestamps = pd.to_datetime(
                df["Date_time"], errors="coerce", utc=True
            )
            keys = pd.DataFrame({
                "turbine": df["Wind_turbine_name"],
                "timestamp": timestamps,
            })
            log("\nWind turbine-timestamp quality:")
            log(f"Unparseable timestamps: {timestamps.isna().sum():,}")
            log(f"Rows in duplicate turbine-timestamp groups: "
                f"{keys.duplicated(['turbine', 'timestamp'], keep=False).sum():,}")

    except Exception as exc:
        log(f"ERROR inspecting CSV: {type(exc).__name__}: {exc}")

hydro_dir = RAW / "hydro"

for path in sorted(hydro_dir.glob("*.nc")):
    log("\n" + "=" * 85)
    log(f"NETCDF: {path.relative_to(ROOT)}")

    try:
        with xr.open_dataset(path) as ds:
            log(f"Dimensions: {dict(ds.sizes)}")
            log(f"Coordinates: {list(ds.coords)}")
            log(f"Global attributes: {dict(ds.attrs)}")
            log("\nVariables:")

            for name, variable in ds.variables.items():
                attrs = dict(variable.attrs)
                log(
                    f"  {name}: dimensions={variable.dims}, "
                    f"shape={variable.shape}, dtype={variable.dtype}, "
                    f"attributes={attrs}"
                )

                if variable.size and variable.dtype.kind in "iuf":
                    try:
                        values = variable.values
                        log(
                            f"    missing={int(variable.isnull().sum().item())}, "
                            f"min={float(variable.min(skipna=True).item()):.5g}, "
                            f"max={float(variable.max(skipna=True).item()):.5g}"
                        )
                    except Exception:
                        pass

    except Exception as exc:
        log(f"ERROR inspecting NetCDF: {type(exc).__name__}: {exc}")

REPORT.write_text("\n".join(report_lines), encoding="utf-8")
print(f"\nAudit saved to: {REPORT}")
