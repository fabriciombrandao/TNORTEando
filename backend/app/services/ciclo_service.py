"""
ciclo_service.py
Geração automática de agenda baseada no ciclo ABC de visitas.
Respeita expediente semanal (manhã/tarde com intervalo de almoço).
"""
import random
from datetime import date, timedelta, time
from typing import List, Dict, Any, Set
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text as sqlt


async def get_parametros(
    db: AsyncSession,
    esn_id: str,
    gsn_id: str,
    org_id: str,
) -> Dict[str, Any]:
    res = await db.execute(sqlt("""
        SELECT
            COALESCE(freq_a_dias, 15)            as freq_a_dias,
            COALESCE(freq_b_dias, 30)            as freq_b_dias,
            COALESCE(freq_c_dias, 45)            as freq_c_dias,
            COALESCE(ciclo_dias, 45)             as ciclo_dias,
            COALESCE(visitas_por_dia_max, 4)     as visitas_por_dia,
            COALESCE(horizonte_dias, 30)         as horizonte_dias,
            COALESCE(frequencia_padrao_dias, 30) as freq_padrao,
            COALESCE(agrupar_por_municipio, true) as agrupar_municipio,
            COALESCE(max_municipios_por_dia, 1)  as max_municipios,
            COALESCE(duracao_padrao_min, 45)     as duracao_min,
            COALESCE(intervalo_entre_visitas_min, 15) as intervalo_min
        FROM parametros_organizacao
        WHERE organizacao_id = :org_id
        LIMIT 1
    """), {"org_id": org_id})
    row = res.fetchone()

    if row:
        return {
            "freq_a_dias": int(row[0]),
            "freq_b_dias": int(row[1]),
            "freq_c_dias": int(row[2]),
            "ciclo_dias": int(row[3]),
            "visitas_por_dia": int(row[4]),
            "horizonte_dias": int(row[5]),
            "freq_padrao": int(row[6]),
            "agrupar_municipio": bool(row[7]),
            "max_municipios": int(row[8]),
            "duracao_min": int(row[9]),
            "intervalo_min": int(row[10]),
        }

    return {
        "freq_a_dias": 15, "freq_b_dias": 30, "freq_c_dias": 45,
        "ciclo_dias": 45, "visitas_por_dia": 4, "horizonte_dias": 30,
        "freq_padrao": 30, "agrupar_municipio": True, "max_municipios": 1,
        "duracao_min": 45, "intervalo_min": 15,
    }


async def get_expediente(db: AsyncSession, org_id: str) -> Dict[int, Dict]:
    """Retorna expediente semanal indexado por dia_semana (0=dom..6=sab)."""
    res = await db.execute(sqlt("""
        SELECT dia_semana, ativo,
               manha_inicio, manha_fim,
               tarde_inicio, tarde_fim
        FROM expediente_semanal
        WHERE organizacao_id = :org_id
        ORDER BY dia_semana
    """), {"org_id": org_id})
    rows = res.fetchall()

    expediente = {}
    for r in rows:
        expediente[r[0]] = {
            "ativo": bool(r[1]),
            "manha_inicio": r[2],
            "manha_fim": r[3],
            "tarde_inicio": r[4],
            "tarde_fim": r[5],
        }

    # Defaults se não configurado
    if not expediente:
        for i in range(7):
            expediente[i] = {
                "ativo": 1 <= i <= 5,
                "manha_inicio": time(8, 0),
                "manha_fim": time(12, 0),
                "tarde_inicio": time(14, 0),
                "tarde_fim": time(18, 0),
            }

    return expediente


def _slots_disponiveis(expediente_dia: Dict, duracao_min: int, intervalo_min: int) -> List[str]:
    """Calcula slots de horário disponíveis em um dia considerando manhã e tarde."""
    if not expediente_dia.get("ativo", False):
        return []

    slots = []
    slot_min = duracao_min + intervalo_min

    def slots_turno(inicio: time, fim: time) -> List[str]:
        turno_slots = []
        atual = inicio.hour * 60 + inicio.minute
        fim_min = fim.hour * 60 + fim.minute
        while atual + duracao_min <= fim_min:
            h, m = divmod(atual, 60)
            turno_slots.append(f"{h:02d}:{m:02d}")
            atual += slot_min
        return turno_slots

    mi = expediente_dia["manha_inicio"]
    mf = expediente_dia["manha_fim"]
    ti = expediente_dia["tarde_inicio"]
    tf = expediente_dia["tarde_fim"]

    if mi and mf:
        slots.extend(slots_turno(mi, mf))
    if ti and tf:
        slots.extend(slots_turno(ti, tf))

    return slots


def _is_dia_util(data: date, feriados: Set[date], expediente: Dict) -> bool:
    """Verifica se o dia é útil (não é feriado e está no expediente ativo)."""
    if data in feriados:
        return False
    dia_semana = data.isoweekday() % 7  # 0=dom, 1=seg, ..., 6=sab
    exp = expediente.get(dia_semana, {})
    return bool(exp.get("ativo", False))


def _proximo_dia_util(data: date, feriados: Set[date], expediente: Dict) -> date:
    """Retorna o próximo dia útil a partir de data (inclusive)."""
    while not _is_dia_util(data, feriados, expediente):
        data += timedelta(days=1)
    return data


def _get_feriados(ano: int, uf: str = "TO") -> Set[date]:
    try:
        import holidays as hol
        br = hol.Brazil(state=uf, years=ano)
        return set(br.keys())
    except Exception:
        return set()


def _calcular_proxima_visita(cliente: dict, params: dict, data_base: date) -> date:
    if cliente.get("proxima_visita_prevista"):
        try:
            d = date.fromisoformat(str(cliente["proxima_visita_prevista"]))
            if d >= data_base:
                return d
        except (ValueError, TypeError):
            pass

    ultima = cliente.get("ultima_visita_em")
    ultima_date = None
    if ultima:
        try:
            ultima_date = date.fromisoformat(str(ultima)[:10])
        except (ValueError, TypeError):
            pass

    freq_cliente = cliente.get("frequencia_visita_dias")
    if freq_cliente and ultima_date:
        return max(ultima_date + timedelta(days=int(freq_cliente)), data_base)

    abc = (cliente.get("classificacao_abc") or "C").upper()
    freq = {"A": params["freq_a_dias"], "B": params["freq_b_dias"]}.get(abc, params["freq_c_dias"])

    if ultima_date:
        return max(ultima_date + timedelta(days=freq), data_base)

    return data_base


async def gerar_agenda_ciclo(
    db: AsyncSession,
    esn_id: str,
    gsn_id: str,
    org_id: str,
    uf_esn: str,
    data_inicio: date,
) -> List[Dict[str, Any]]:
    params = await get_parametros(db, esn_id, gsn_id, org_id)
    expediente = await get_expediente(db, org_id)
    data_fim = data_inicio + timedelta(days=params["horizonte_dias"])

    # Feriados
    feriados: Set[date] = _get_feriados(data_inicio.year, uf_esn)
    if data_fim.year != data_inicio.year:
        feriados |= _get_feriados(data_fim.year, uf_esn)

    res_fer = await db.execute(sqlt("""
        SELECT dia, mes, ano FROM feriados
        WHERE ativo = true AND (uf = :uf OR uf IS NULL)
    """), {"uf": uf_esn})
    for r in res_fer.fetchall():
        try:
            ano_fer = r[2] if r[2] else data_inicio.year
            feriados.add(date(ano_fer, r[1], r[0]))
            if not r[2]:
                feriados.add(date(data_fim.year, r[1], r[0]))
        except (ValueError, TypeError):
            pass

    # Clientes do ESN
    res = await db.execute(sqlt("""
        SELECT c.id, c.razao_social, c.municipio, c.uf,
               c.classificacao_abc, c.frequencia_visita_dias,
               c.ultima_visita_em, c.proxima_visita_prevista
        FROM clientes c
        WHERE c.vendedor_responsavel_id = :esn_id AND c.ativo = true
        ORDER BY c.classificacao_abc, c.razao_social
    """), {"esn_id": esn_id})
    clientes = [
        {
            "id": str(r[0]), "razao_social": r[1], "municipio": r[2], "uf": r[3],
            "classificacao_abc": r[4], "frequencia_visita_dias": r[5],
            "ultima_visita_em": r[6], "proxima_visita_prevista": r[7],
        }
        for r in res.fetchall()
    ]

    if not clientes:
        return []

    # Calcular próxima visita necessária
    visitas_necessarias = []
    for c in clientes:
        proxima = _calcular_proxima_visita(c, params, data_inicio)
        if proxima <= data_fim:
            visitas_necessarias.append({
                "cliente_id": c["id"],
                "municipio": c["municipio"] or "",
                "proxima": proxima,
                "abc": c["classificacao_abc"] or "C",
            })

    # Ordenar por urgência e embaralhar dentro do mesmo dia
    visitas_necessarias.sort(key=lambda x: x["proxima"])
    from itertools import groupby
    grupos = []
    for data_prox, grupo in groupby(visitas_necessarias, key=lambda x: x["proxima"]):
        g = list(grupo)
        random.shuffle(g)
        grupos.extend(g)
    visitas_necessarias = grupos

    # Distribuir nos dias úteis respeitando expediente
    agenda: Dict[date, List[dict]] = {}
    municipios_por_dia: Dict[date, set] = {}

    for visita in visitas_necessarias:
        dia_candidato = _proximo_dia_util(visita["proxima"], feriados, expediente)

        tentativas = 0
        while tentativas < params["horizonte_dias"]:
            if dia_candidato > data_fim:
                break

            visitas_do_dia = agenda.get(dia_candidato, [])
            municipios_do_dia = municipios_por_dia.get(dia_candidato, set())

            # Verificar slots disponíveis no expediente
            dia_semana = dia_candidato.isoweekday() % 7
            exp_dia = expediente.get(dia_semana, {})
            slots = _slots_disponiveis(exp_dia, params["duracao_min"], params["intervalo_min"])

            max_visitas = min(params["visitas_por_dia"], len(slots))
            if len(visitas_do_dia) >= max_visitas:
                dia_candidato = _proximo_dia_util(dia_candidato + timedelta(days=1), feriados, expediente)
                tentativas += 1
                continue

            mun = visita["municipio"]
            if params["agrupar_municipio"] and mun:
                if len(municipios_do_dia) >= params["max_municipios"] and mun not in municipios_do_dia:
                    dia_candidato = _proximo_dia_util(dia_candidato + timedelta(days=1), feriados, expediente)
                    tentativas += 1
                    continue

            if dia_candidato not in agenda:
                agenda[dia_candidato] = []
                municipios_por_dia[dia_candidato] = set()

            # Atribuir horário do slot correspondente
            idx = len(agenda[dia_candidato])
            horario = slots[idx] if idx < len(slots) else None

            agenda[dia_candidato].append({**visita, "horario": horario})
            if mun:
                municipios_por_dia[dia_candidato].add(mun)
            break

    # Montar resultado
    resultado = []
    for dia in sorted(agenda.keys()):
        for idx, visita in enumerate(agenda[dia]):
            resultado.append({
                "data": dia,
                "cliente_id": visita["cliente_id"],
                "municipio": visita["municipio"],
                "ordem": idx + 1,
                "abc": visita["abc"],
                "horario": visita.get("horario"),
            })

    return resultado
