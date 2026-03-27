import axios from "axios";
import { useAuthStore } from "../store/auth";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────
export const login = async (email: string, senha: string) => {
  const form = new FormData();
  form.append("username", email);
  form.append("password", senha);
  const { data } = await api.post("/api/v1/auth/login", form);
  return data;
};

// ── Clientes ─────────────────────────────────
export const getClientes = () => api.get("/api/v1/clientes").then((r) => r.data);

// ── Agenda ───────────────────────────────────
export const getAgendaHoje = () => api.get("/api/v1/agenda/hoje").then((r) => r.data);

export const criarAgendaOtimizada = (payload: {
  data: string;
  cliente_ids: string[];
  lat_inicio: number;
  lng_inicio: number;
  horario_inicio?: string;
  duracao_padrao_min?: number;
}) => api.post("/api/v1/agenda/otimizada", payload).then((r) => r.data);

// ── Visitas ───────────────────────────────────
export const getVisitaEmAndamento = () =>
  api.get("/api/v1/visitas/em-andamento").then((r) => r.data);

export const checkin = (payload: {
  cliente_id: string;
  lat: number;
  lng: number;
  agenda_item_id?: string;
}) => api.post("/api/v1/visitas/checkin", payload).then((r) => r.data);

export const checkout = (
  visita_id: string,
  payload: { lat: number; lng: number; observacoes?: string }
) => api.post(`/api/v1/visitas/${visita_id}/checkout`, payload).then((r) => r.data);

// ── Importação ────────────────────────────────
export const importarCSV = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/api/v1/importacao/csv", form).then((r) => r.data);
};

export default api;
