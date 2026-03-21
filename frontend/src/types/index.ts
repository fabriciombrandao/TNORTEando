export type Papel = "GESTOR_EMPRESA" | "DSN" | "GSN" | "ESN";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
}

export interface Cliente {
  id: string;
  codigo_externo: string;
  razao_social: string;
  municipio: string | null;
  uf: string | null;
  lat: number | null;
  lng: number | null;
  status_atribuicao: "ATRIBUIDO" | "PENDENTE";
}

export interface AgendaItem {
  id: string;
  cliente_id: string;
  ordem: number;
  horario_previsto: string | null;
  status: "PENDENTE" | "CONCLUIDO" | "CANCELADO" | "REAGENDADO";
}

export interface Agenda {
  agenda_id: string;
  data: string;
  itens: AgendaItem[];
}

export interface Visita {
  visita_id: string;
  cliente_id: string;
  checkin_em: string;
  checkout_em?: string;
  duracao_minutos?: number;
}

export interface ResultadoImportacao {
  sucesso: boolean;
  organizacoes_criadas: number;
  usuarios_criados: number;
  vinculos_criados: number;
  clientes_criados: number;
  contratos_criados: number;
  clientes_orfaos: { codigo: string; razao_social: string; municipio: string | null; uf: string | null }[];
  clientes_sem_municipio: { codigo: string; razao_social: string }[];
  avisos: string[];
  erros: string[];
}
