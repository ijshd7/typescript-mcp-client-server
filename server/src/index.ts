import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    status?: string;
    headline?: string;
  };
}

interface StationObservation {
  properties: {
    timestamp?: string;
    temperature?: {
      value?: number;
      unitCode?: string;
    };
    relativeHumidity?: {
      value?: number;
    };
    windSpeed?: {
      value?: number;
      unitCode?: string;
    };
    windDirection?: {
      value?: number;
    };
    barometricPressure?: {
      value?: number;
      unitCode?: string;
    };
    visibility?: {
      value?: number;
      unitCode?: string;
    };
    textDescription?: string;
  };
}

interface StationsResponse {
  features: Array<{
    properties: {
      stationIdentifier?: string;
      name?: string;
    };
  }>;
}

interface RadarStation {
  properties: {
    id?: string;
    name?: string;
    stationType?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface RadarStationsResponse {
  features: RadarStation[];
}

interface ZoneResponse {
  properties: {
    id?: string;
    name?: string;
    state?: string;
    type?: string;
  };
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties;
  return [
    `Event: ${props.event || "Unknown"}`,
    `Area: ${props.areaDesc || "Unknown"}`,
    `Severity: ${props.severity || "Unknown"}`,
    `Status: ${props.status || "Unknown"}`,
    `Headline: ${props.headline || "No headline"}`,
    "---",
  ].join("\n");
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

// Create server instance
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

// Register weather tools
server.tool(
  "get-alerts",
  "Get weather alerts for a state",
  {
    state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
  },
  async ({ state }) => {
    const stateCode = state.toUpperCase();
    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve alerts data",
          },
        ],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No active alerts for ${stateCode}`,
          },
        ],
      };
    }

    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  },
);

server.tool(
  "get-forecast",
  "Get weather forecast for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    // Get grid point data
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
          },
        ],
      };
    }

    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to get forecast URL from grid point data",
          },
        ],
      };
    }

    // Get forecast data
    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve forecast data",
          },
        ],
      };
    }

    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No forecast periods available",
          },
        ],
      };
    }

    // Format forecast periods
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
      ].join("\n"),
    );

    const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  },
);

// Get current weather conditions from nearest station
server.tool(
  "get-current-conditions",
  "Get current weather conditions from the nearest weather station",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    try {
      // Get nearby stations
      const stationsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}/stations`;
      const stationsData = await makeNWSRequest<StationsResponse>(stationsUrl);

      if (!stationsData || !stationsData.features || stationsData.features.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No weather stations found near this location",
          }],
        };
      }

      // Get observation from first available station
      const station = stationsData.features[0];
      const stationId = station.properties?.stationIdentifier;
      
      if (!stationId) {
        return {
          content: [{
            type: "text",
            text: "No valid station identifier found",
          }],
        };
      }

      const observationUrl = `${NWS_API_BASE}/stations/${stationId}/observations/latest`;
      const observationData = await makeNWSRequest<StationObservation>(observationUrl);

      if (!observationData) {
        return {
          content: [{
            type: "text",
            text: "Failed to retrieve current conditions",
          }],
        };
      }

      const props = observationData.properties;
      const temp = props.temperature?.value;
      const tempUnit = props.temperature?.unitCode?.includes('celsius') ? 'C' : 'F';
      const humidity = props.relativeHumidity?.value;
      const windSpeed = props.windSpeed?.value;
      const windDir = props.windDirection?.value;
      const pressure = props.barometricPressure?.value;
      const visibility = props.visibility?.value;
      
      const conditions = [
        `Current conditions near ${latitude}, ${longitude}:`,
        `Station: ${station.properties?.name || stationId}`,
        `Observed: ${props.timestamp ? new Date(props.timestamp).toLocaleString() : 'Unknown'}`,
        `Temperature: ${temp ? Math.round(temp) : 'Unknown'}°${tempUnit}`,
        `Humidity: ${humidity ? Math.round(humidity) : 'Unknown'}%`,
        `Wind: ${windSpeed ? Math.round(windSpeed * 2.237) : 'Unknown'} mph ${windDir ? `from ${Math.round(windDir)}°` : ''}`,
        `Pressure: ${pressure ? (pressure / 100).toFixed(2) : 'Unknown'} mb`,
        `Visibility: ${visibility ? (visibility / 1609).toFixed(1) : 'Unknown'} miles`,
        `Description: ${props.textDescription || 'Not available'}`,
      ].join('\n');

      return {
        content: [{
          type: "text",
          text: conditions,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error retrieving current conditions: ${error}`,
        }],
      };
    }
  }
);

// Get hourly forecast
server.tool(
  "get-hourly-forecast",
  "Get hourly weather forecast for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
    hours: z.number().min(1).max(156).default(24).describe("Number of hours to forecast (max 156)"),
  },
  async ({ latitude, longitude, hours }) => {
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [{
          type: "text",
          text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}`,
        }],
      };
    }

    const forecastUrl = pointsData.properties?.forecast?.replace('/forecast', '/forecast/hourly');
    if (!forecastUrl) {
      return {
        content: [{
          type: "text",
          text: "Failed to get hourly forecast URL",
        }],
      };
    }

    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [{
          type: "text",
          text: "Failed to retrieve hourly forecast data",
        }],
      };
    }

    const periods = forecastData.properties?.periods?.slice(0, hours) || [];
    if (periods.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No hourly forecast periods available",
        }],
      };
    }

    const formattedForecast = periods.map((period: ForecastPeriod) => 
      `${period.name}: ${period.temperature}°${period.temperatureUnit} - ${period.shortForecast}`
    ).join('\n');

    return {
      content: [{
        type: "text",
        text: `${hours}-hour forecast for ${latitude}, ${longitude}:\n\n${formattedForecast}`,
      }],
    };
  }
);

// Get radar stations
server.tool(
  "get-radar-stations",
  "Get nearby weather radar stations",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
    distance: z.number().min(1).max(500).default(100).describe("Search radius in miles"),
  },
  async ({ latitude, longitude, distance }) => {
    const radarUrl = `${NWS_API_BASE}/radar/stations`;
    const radarData = await makeNWSRequest<RadarStationsResponse>(radarUrl);

    if (!radarData || !radarData.features) {
      return {
        content: [{
          type: "text",
          text: "Failed to retrieve radar stations",
        }],
      };
    }

    // Calculate distance and filter stations
    const nearbyStations = radarData.features
      .filter(station => {
        const stationLat = station.properties?.latitude;
        const stationLon = station.properties?.longitude;
        if (!stationLat || !stationLon) return false;

        // Simple distance calculation (approximate)
        const latDiff = latitude - stationLat;
        const lonDiff = longitude - stationLon;
        const distanceKm = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111;
        const distanceMiles = distanceKm * 0.621371;
        
        return distanceMiles <= distance;
      })
      .sort((a, b) => {
        // Sort by distance (approximate)
        const aLat = a.properties?.latitude || 0;
        const aLon = a.properties?.longitude || 0;
        const bLat = b.properties?.latitude || 0;
        const bLon = b.properties?.longitude || 0;
        
        const aDist = Math.sqrt((latitude - aLat) ** 2 + (longitude - aLon) ** 2);
        const bDist = Math.sqrt((latitude - bLat) ** 2 + (longitude - bLon) ** 2);
        
        return aDist - bDist;
      })
      .slice(0, 10); // Limit to 10 stations

    if (nearbyStations.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No radar stations found within ${distance} miles of ${latitude}, ${longitude}`,
        }],
      };
    }

    const stationsList = nearbyStations.map(station => {
      const props = station.properties;
      return `${props?.id}: ${props?.name} (${props?.stationType})`;
    }).join('\n');

    return {
      content: [{
        type: "text",
        text: `Radar stations within ${distance} miles of ${latitude}, ${longitude}:\n\n${stationsList}`,
      }],
    };
  }
);

// Get zone information
server.tool(
  "get-zone-info",
  "Get weather zone information for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<any>(pointsUrl);

    if (!pointsData) {
      return {
        content: [{
          type: "text",
          text: "Failed to retrieve zone information",
        }],
      };
    }

    const props = pointsData.properties;
    const forecastZone = props?.forecastZone;
    const county = props?.county;
    const fireWeatherZone = props?.fireWeatherZone;

    const zoneInfo = [
      `Zone information for ${latitude}, ${longitude}:`,
      `Forecast Zone: ${forecastZone || 'Unknown'}`,
      `County: ${county || 'Unknown'}`,
      `Fire Weather Zone: ${fireWeatherZone || 'Unknown'}`,
      `Grid ID: ${props?.gridId || 'Unknown'}`,
      `Grid X,Y: ${props?.gridX || 'Unknown'}, ${props?.gridY || 'Unknown'}`,
    ].join('\n');

    return {
      content: [{
        type: "text",
        text: zoneInfo,
      }],
    };
  }
);

// Get active weather alerts by zone
server.tool(
  "get-zone-alerts",
  "Get weather alerts for a specific zone",
  {
    zoneId: z.string().describe("Zone ID (e.g., 'CAZ006', 'NYZ001')"),
  },
  async ({ zoneId }) => {
    const alertsUrl = `${NWS_API_BASE}/alerts?zone=${zoneId.toUpperCase()}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      return {
        content: [{
          type: "text",
          text: "Failed to retrieve zone alerts",
        }],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No active alerts for zone ${zoneId}`,
        }],
      };
    }

    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for zone ${zoneId}:\n\n${formattedAlerts.join('\n')}`;

    return {
      content: [{
        type: "text",
        text: alertsText,
      }],
    };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});