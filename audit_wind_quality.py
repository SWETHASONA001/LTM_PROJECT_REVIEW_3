import pandas as pd

path = "data/raw/wind/la-haute-borne-data-2017-2020.csv"
df = pd.read_csv(path, sep=";", usecols=[
    "Wind_turbine_name", "Date_time", "P_avg", "Ws_avg", "Wa_avg"
])

df["Date_time"] = pd.to_datetime(df["Date_time"], errors="coerce", utc=True)

print("\n--- DATASET SHAPE ---")
print("Rows:", len(df))
print("Columns:", len(df.columns))

print("\n--- MISSING VALUES ---")
print(df[["Wind_turbine_name", "Date_time", "P_avg", "Ws_avg", "Wa_avg"]].isna().sum())

print("\n--- DUPLICATES ---")
print("Duplicate turbine-timestamp pairs:",
      df.duplicated(["Wind_turbine_name", "Date_time"]).sum())

print("\n--- PER-TURBINE SUMMARY ---")
print(df.groupby("Wind_turbine_name")[["P_avg", "Ws_avg", "Wa_avg"]].agg(
    ["count", "mean", "min", "max"]
).round(3))

print("\n--- POWER VALUES ---")
print("Negative power rows:", (df["P_avg"] < 0).sum())
print("Zero power rows:", (df["P_avg"] == 0).sum())
print("Missing timestamps:", df["Date_time"].isna().sum())
