This README file was created by the MHKDR curation team on 8/6/2025 using the originally submitted dataset description.

The files are in netCDF format and each filename represents the site code defined in the paper (e.g., 'CS.nc' is data from Cook Strait, New Zealand). The full name for each file and site is provided in the submission resource descriptions. The processed data for each site includes:

- lat: Latitude in degrees North
- lon: Longitude in degrees North
- time: Hours since Jan 1, 2000
- bin_height: Height of bins relative to the bed in meters
- principal profile: Current depth profile in principal flow directions, measured in meters per second. (+) depth-averaged velocity indicates flood currents and (-) ebb currents.
- depth: Water depth in meters
- alpha: Power exponent of a power law fit
- beta: Bed roughness coefficient of a power law fit
- RMSE: Root mean squared error (RMSE) between measured profile and the corresponding power law fit
- label: Label for profile classification based on shape
	0: below minimum operation speed of 0.75 m/s
	1: monotonic
	2: non-monotonic (concave)
	3: non-monotonic (convex)
	4: non-monotonic (mix-concavity)
	5: pseudo-depth-uniform
- flood_idx_qs: A binary array where 1 indicates quasi-steady profile during flood tide, while 0 indicates otherwise
- flood_idx_acc: A binary array where 1 indicates accelerating profile during flood tide, while 0 indicates otherwise
- flood_idx_dec: A binary array where 1 indicates decelerating profile during flood tide, while 0 indicates otherwise
- ebb_idx_qs: A binary array where 1 indicates quasi-steady profile during ebb tide, while 0 indicates otherwise
- ebb_idx_acc: A binary array where 1 indicates accelerating profile during ebb tide, while 0 indicates otherwise
- ebb_idx_dec: A binary array where 1 indicates decelerating profile during ebb tide, while 0 indicates otherwise