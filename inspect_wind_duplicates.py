import pandas as pd

path = "data/raw/wind/la-haute-borne-data-2017-2020.csv"

df = pd.read_csv(
    path,
    sep=";",
    usecols=["Wind_turbine_name", "Date_time", "P_avg", "Ws_avg", "Wa_avg"]
)

df["Date_time"] = pd.to_datetime(
    df["Date_time"], errors="coerce", utc=True
)

keys = ["Wind_turbine_name", "Date_time"]
duplicate_rows = df[df.duplicated(keys, keep=False)].sort_values(keys)

print("Rows involved in duplicate pairs:", len(duplicate_rows))
print("\nFirst 20 duplicate records:")
print(duplicate_rows.head(20).to_string(index=False))

print("\nMissing values by turbine:")
print(
    df.groupby("Wind_turbine_name")[
        ["P_avg", "Ws_avg", "Wa_avg"]
    ].apply(lambda group: group.isna().sum())
)

print("\nPower and wind speed percentiles:")
print(
    df[["P_avg", "Ws_avg"]]
    .quantile([0, 0.01, 0.25, 0.5, 0.75, 0.99, 1])
    .round(3)
)
