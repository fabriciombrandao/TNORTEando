import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Usuario } from "../types";

interface AuthState {
  usuario: Usuario | null;
  accessToken: string | null;
  setAuth: (usuario: Usuario, token: string) => void;
  logout: () => void;
  isLoggedIn: () => boolean;
  podeVerTudo: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      usuario: null,
      accessToken: null,
      setAuth: (usuario, accessToken) => set({ usuario, accessToken }),
      logout: () => set({ usuario: null, accessToken: null }),
      isLoggedIn: () => !!get().accessToken,
      podeVerTudo: () => {
        const papel = get().usuario?.papel;
        return papel === "GESTOR_EMPRESA" || papel === "DSN" || papel === "GSN";
      },
    }),
    { name: "visitas-auth" }
  )
);
