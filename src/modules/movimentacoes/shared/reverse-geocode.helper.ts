interface NominatimResponse {
  address?: {
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    village?: string;
    town?: string;
    city?: string;
    municipality?: string;
    county?: string;
    state?: string;
  };
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=pt-BR`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'horautil360-backend/1.0' },
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) return fallbackLocation(latitude, longitude);

    const data = (await response.json()) as NominatimResponse;
    const addr = data.address;

    if (!addr) return fallbackLocation(latitude, longitude);

    const label =
      addr.neighbourhood ??
      addr.suburb ??
      addr.quarter ??
      addr.village ??
      addr.town ??
      addr.city ??
      addr.municipality ??
      addr.county ??
      addr.state;

    return label ?? fallbackLocation(latitude, longitude);
  } catch {
    return fallbackLocation(latitude, longitude);
  }
}

function fallbackLocation(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
