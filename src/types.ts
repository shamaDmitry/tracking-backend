export interface PointObject {
  id: string;
  lat: number;
  lng: number;
  direction: number;
  status: "active" | "lost";
}
