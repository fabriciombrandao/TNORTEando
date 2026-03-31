"""
ciclo_service.py
Geração automática de agenda baseada no ciclo ABC de visitas.
"""
from datetime import date, timedelta
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text as sqlt
import json


async def get_parametros(
    db: AsyncSession,
    esn_id: str,
    gsn_id: str,
    org_id: str,
) -> Dict[str, Any]:
    """
    Retorna parâmetros efetivos para um ESN.
    Prioridade: ESN > GSN > Organização > defaults
    """
    # Buscar parâmetros da organização
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
            COALESCE(max_municipios_por_dia, 1)  as max_municipios
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
        }

    return {
        "freq_a_dias": 15, "freq_b_dias": 30, "freq_c_dias": 45,
        "ciclo_dias": 45, "visitas_por_dia": 4, "horizonte_dias": 30,
        "freq_padrao": 30, "agrupar_municipio": True, "max_municipios": 1,
    }


def _proximo_dia_util(data: date, feriados: set) -> date:
    """Retorna o próximo dia útil a partir de data (inclusive)."""
    while data.weekday() >= 5 or data in feriados:
        data += timedelta(days=1)
    return data


def _get_feriados(ano: int, uf: str = "TO") -> set:
    """Retorna conjunto de feriados para o ano/UF usando biblioteca holidays."""
    try:
        import holidays as hol
        br = hol.Brazil(state=uf, years=ano)
        return set(br.keys())
    except Exception:
        return set()


def _calcular_proxima_visita(
    cliente: dict,
    params: dict,
    data_base: date,
) -> date:
    """
    Calcula a data da próxima visita para um cliente.
    Prioridade:
    1. proxima_visita_prevista do cliente
    2. ultima_visita_em + frequencia_visita_dias do cliente
    3. ultima_visita_em + frequência por ABC dos parâmetros
    4. data_base (nunca visitado)
    """
    # 1. Próxima visita prevista definida no checkout
    if cliente.get("proxima_visita_prevista"):
        try:
            data = date.fromisoformat(str(cliente["proxima_visita_prevista"]))
            if data >= data_base:
                return data
        except (ValueError, TypeError):
            pass

    ultima = cliente.get("ultima_visita_em")
    if ultima:
        try:
            ultima_date = date.fromisoformat(str(ultima)[:10])
        except (ValueError, TypeError):
            ultima_date = None
    else:
        ultima_date = None

    # 2. Frequência específica do cliente
    freq_cliente = cliente.get("frequencia_visita_dias")
    if freq_cliente and ultima_date:
        proxima = ultima_date + timedelta(days=int(freq_cliente))
        return max(proxima, data_base)

    # 3. Frequência por ABC
    abc = (cliente.get("classificacao_abc") or "C").upper()
    if abc == "A":
        freq = params["freq_a_dias"]
    elif abc == "B":
        freq = params["freq_b_dias"]
    else:
        freq = params["freq_c_dias"]

    if ultima_date:
        proxima = ultima_date + timedelta(days=freq)
        return max(proxima, data_base)

    # 4. Nunca visitado — usar data_base
    return data_base


async def gerar_agenda_ciclo(
    db: AsyncSession,
    esn_id: str,
    gsn_id: str,
    org_id: str,
    uf_esn: str,
    data_inicio: date,
) -> List[Dict[str, Any]]:
    """
    Gera a agenda para um ESN baseada no ciclo ABC.
    Retorna lista de {data, cliente_id, ordem, municipio}.
    """
    params = await get_parametros(db, esn_id, gsn_id, org_id)

    data_fim = data_inicio + timedelta(days=params["horizonte_dias"])

    # Buscar feriados do período
    feriados = _get_feriados(data_inicio.year, uf_esn)
    if data_fim.year != data_inicio.year:
        feriados |= _get_feriados(data_fim.year, uf_esn)

    # Buscar feriados municipais cadastrados
    res_fer = await db.execute(sqlt("""
        SELECT dia, mes, ano FROM feriados
        WHERE ativo = true AND (uf = :uf OR uf IS NULL)
    """), {"uf": uf_esn})
    for r in res_fer.fetchall():
        try:
            ano_fer = r[2] if r[2] else data_inicio.year
            feriados.add(date(ano_fer, r[1], r[0]))
            if not r[2]:  # recorrente — adicionar para ambos os anos
                feriados.add(date(data_fim.year, r[1], r[0]))
        except (ValueError, TypeError):
            pass

    # Buscar clientes do ESN com dados necessários
    res = await db.execute(sqlt("""
        SELECT
            c.id, c.razao_social, c.municipio, c.uf,
            c.classificacao_abc, c.frequencia_visita_dias,
            c.ultima_visita_em, c.proxima_visita_prevista,
            c.lat, c.lng
        FROM clientes c
        WHERE c.vendedor_responsavel_id = :esn_id
          AND c.ativo = true
        ORDER BY c.classificacao_abc, c.razao_social
    """), {"esn_id": esn_id})
    clientes = [
        {
            "id": str(r[0]), "razao_social": r[1], "municipio": r[2], "uf": r[3],
            "classificacao_abc": r[4], "frequencia_visita_dias": r[5],
            "ultima_visita_em": r[6], "proxima_visita_prevista": r[7],
            "lat": r[8], "lng": r[9],
        }
        for r in res.fetchall()
    ]

    if not clientes:
        return []

    # Calcular próxima visita para cada cliente
    visitas_necessarias = []
    for c in clientes:
        proxima = _calcular_proxima_visita(c, params, data_inicio)
        if proxima <= data_fim:
            visitas_necessarias.append({
                "cliente_id": c["id"],
                "municipio": c["municipio"] or "",
                "proxima": proxima,
                "abc": c["classificacao_abc"] or "C",
                "razao_social": c["razao_social"],
            })

    # Ordenar por urgência (mais atrasados/próximos primeiro)
    visitas_necessarias.sort(key=lambda x: x["proxima"])

    # Distribuir nos dias úteis
    # Mapa: data -> lista de visitas agendadas
    agenda: Dict[date, List[dict]] = {}
    municipios_por_dia: Dict[date, set] = {}

    for visita in visitas_necessarias:
        # Encontrar o dia disponível a partir da data necessária
        dia_candidato = _proximo_dia_util(visita["proxima"], feriados)

        # Tentar encaixar respeitando limites
        tentativas = 0
        while tentativas < params["horizonte_dias"]:
            if dia_candidato > data_fim:
                break

            visitas_do_dia = agenda.get(dia_candidato, [])
            municipios_do_dia = municipios_por_dia.get(dia_candidato, set())

            # Verificar limite de visitas por dia
            if len(visitas_do_dia) >= params["visitas_por_dia"]:
                dia_candidato = _proximo_dia_util(dia_candidato + timedelta(days=1), feriados)
                tentativas += 1
                continue

            # Verificar agrupamento por município
            mun = visita["municipio"]
            if params["agrupar_municipio"] and mun:
                if len(municipios_do_dia) >= params["max_municipios"] and mun not in municipios_do_dia:
                    dia_candidato = _proximo_dia_util(dia_candidato + timedelta(days=1), feriados)
                    tentativas += 1
                    continue

            # Encaixar a visita
            if dia_candidato not in agenda:
                agenda[dia_candidato] = []
                municipios_por_dia[dia_candidato] = set()

            agenda[dia_candidato].append(visita)
            if mun:
                municipios_por_dia[dia_candidato].add(mun)
            break

    # Montar resultado ordenado
    resultado = []
    for dia in sorted(agenda.keys()):
        for idx, visita in enumerate(agenda[dia]):
            resultado.append({
                "data": dia,
                "cliente_id": visita["cliente_id"],
                "municipio": visita["municipio"],
                "ordem": idx + 1,
                "abc": visita["abc"],
            })

    return resultado
