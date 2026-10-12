import pandas as pd

file_path = "data/raw/wind/la-haute-borne-data-2017-2020.csv"

counts = {}
earliest = None
latest = None
total_rows = 0

for chunk in pd.read_csv(
    file_path,
    sep=";",
    usecols=["Wind_turbine_name", "Date_time"],
    chunksize=100_000
):
    total_rows += len(chunk)

    turbine_counts = chunk["Wind_turbine_name"].value_counts()
    for turbine, count in turbine_counts.items():
        counts[turbine] = counts.get(turbine, 0) + int(count)

    dates = pd.to_datetime(chunk["Date_time"], errors="coerce", utc=True).dropna()
    if not dates.empty:
        chunk_min = dates.min()
        chunk_max = dates.max()
        earliest = chunk_min if earliest is None else min(earliest, chunk_min)
        latest = chunk_max if latest is None else max(latest, chunk_max)

print("Total rows:", total_rows)
print("Rows per turbine:")
for turbine, count in sorted(counts.items()):
    print(f"  {turbine}: {count:,}")

print("Date range:", earliest, "to", latest)
