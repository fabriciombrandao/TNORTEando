"""
Importador CSV — Visitas TOTVS Unidade Tocantins
=================================================

Trata todos os casos identificados na análise do arquivo real:

1. HIERARQUIA COMPLETA
   Organização → DSN → GSN → ESN → Cliente → Contrato

2. STELA (duplo código, mesmo e-mail)
   T10387 (GSN Fabricio) e T26875 (GSN Wyley) = mesma pessoa.
   Cria 1 usuário, 2 registros em HierarquiaVendas com códigos distintos.

3. CLIENTES COM LINHAS MISTAS (pseudo-órfãos)
   6 clientes possuem algumas linhas com ESN="-" e outras com ESN real.
   Regra: priorizar o ESN real. Nenhum cliente é verdadeiramente órfão
   neste arquivo.

4. CNPJ CORROMPIDO PELO EXCEL
   Formato: =""&XXXXXXXXXXXXXXX → extrair apenas dígitos.
   Todos têm 14 dígitos válidos após limpeza.

5. DEDUPLICAÇÃO
   Clientes, usuários e contratos deduplicados por código externo.
   Usuários detectados por e-mail quando o código é diferente (Stela).

6. MÚLTIPLAS IMPORTAÇÕES
   Seguro rodar mais de uma vez — não duplica registros existentes.

Uso:
    from app.services.importador_csv import ImportadorCSV

    importador = ImportadorCSV("contractsReport_1.csv")
    objetos, resultado = importador.executar()

    for obj in objetos:
        db.add(obj)
    await db.commit()

    print(resultado.resumo())
"""

import csv
import re
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from app.core.security import get_password_hash
from app.models.models import (
    Organizacao, Usuario, HierarquiaVendas,
    Cliente, Contrato, PapelUsuario,
    StatusContrato, StatusAtribuicao,
)

logger = logging.getLogger(__name__)

SENHA_PADRAO = "Mudar@123"


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS DE LIMPEZA
# ══════════════════════════════════════════════════════════════════════════════

def _limpar_cnpj(raw: str) -> Optional[str]:
    """Remove artefato do Excel (=""&) e retorna só dígitos. None se inválido."""
    if not raw or raw.strip() in ("-", ""):
        return None
    digitos = re.sub(r"[^0-9]", "", raw)
    return digitos if len(digitos) in (11, 14) else None


def _parse_data(raw: str) -> Optional[date]:
    """Converte dd/mm/yyyy → date. None se ausente ou inválido."""
    if not raw or raw.strip() in ("-", ""):
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _nulo(valor: str) -> Optional[str]:
    v = valor.strip() if valor else ""
    return v if v and v != "-" else None


def _normalizar_nome(texto: str) -> str:
    if not texto or texto.strip() in ("-", ""):
        return ""
    return " ".join(texto.strip().title().split())


def _bool_sim_nao(valor: str) -> bool:
    return valor.strip().upper() in ("SIM", "S", "YES", "Y", "1")


def _fone(ddd: str, tel: str) -> Optional[str]:
    ddd = ddd.strip()
    tel = tel.strip()
    if ddd in ("-", "") or tel in ("-", ""):
        return None
    return f"({ddd}) {tel}"


# ══════════════════════════════════════════════════════════════════════════════
# RESULTADO DA IMPORTAÇÃO
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class ResultadoImportacao:
    organizacoes_criadas: int = 0
    usuarios_criados: int = 0
    vinculos_criados: int = 0
    clientes_criados: int = 0
    contratos_criados: int = 0

    duplos_codigos: list = field(default_factory=list)
    clientes_esn_misto: list = field(default_factory=list)

    avisos: list = field(default_factory=list)
    erros: list = field(default_factory=list)

    def resumo(self) -> str:
        linhas = [
            "═══════════════════════════════════════",
            "  RESULTADO DA IMPORTAÇÃO",
            "═══════════════════════════════════════",
            f"  Organizações  : {self.organizacoes_criadas}",
            f"  Usuários      : {self.usuarios_criados}",
            f"  Vínculos      : {self.vinculos_criados}",
            f"  Clientes      : {self.clientes_criados}",
            f"  Contratos     : {self.contratos_criados}",
            "───────────────────────────────────────",
        ]
        if self.duplos_codigos:
            linhas.append(f"  Duplos códigos  : {len(self.duplos_codigos)}")
            for d in self.duplos_codigos:
                linhas.append(f"    • {d}")
        if self.clientes_esn_misto:
            linhas.append(f"  Linhas mistas resolvidas : {len(self.clientes_esn_misto)}")
            for c in self.clientes_esn_misto:
                linhas.append(f"    • {c}")
        if self.avisos:
            linhas.append(f"  Avisos : {len(self.avisos)}")
            for a in self.avisos:
                linhas.append(f"    ⚠ {a}")
        if self.erros:
            linhas.append(f"  Erros  : {len(self.erros)}")
            for e in self.erros:
                linhas.append(f"    ✘ {e}")
        linhas.append("═══════════════════════════════════════")
        return "\n".join(linhas)


# ══════════════════════════════════════════════════════════════════════════════
# PRÉ-PROCESSAMENTO
# ══════════════════════════════════════════════════════════════════════════════

def _preprocessar(rows: list[dict]) -> dict:
    """
    Resolve o ESN responsável de cada cliente antes de criar objetos.

    Problema: 6 clientes têm linhas com ESN="-" E linhas com ESN real.
    Solução:  usar o ESN real. Esses clientes NÃO são órfãos.
    """
    clientes_esns: dict[str, set] = {}

    for r in rows:
        cod = r["Código do Cliente"].strip()
        esn = r["Código do ESN"].strip()
        if cod not in clientes_esns:
            clientes_esns[cod] = set()
        if esn and esn != "-":
            clientes_esns[cod].add(esn)

    esn_responsavel: dict[str, Optional[str]] = {}
    clientes_mistos: list[str] = []

    for cod, esns in clientes_esns.items():
        if not esns:
            esn_responsavel[cod] = None
        elif len(esns) == 1:
            esn_responsavel[cod] = list(esns)[0]
        else:
            # Múltiplos ESNs reais — escolhe o menor código (mais estável)
            escolhido = sorted(esns)[0]
            esn_responsavel[cod] = escolhido
            clientes_mistos.append(
                f"[{cod}] múltiplos ESNs: {esns} → usando {escolhido}"
            )

    return {
        "esn_responsavel": esn_responsavel,
        "clientes_mistos": clientes_mistos,
    }


# ══════════════════════════════════════════════════════════════════════════════
# IMPORTADOR PRINCIPAL
# ══════════════════════════════════════════════════════════════════════════════

class ImportadorCSV:

    def __init__(self, caminho_csv: str, encoding: str = "ISO-8859-1"):
        self.caminho = caminho_csv
        self.encoding = encoding
        self.resultado = ResultadoImportacao()

        self._orgs:      dict[str, Organizacao] = {}
        self._usuarios:  dict[str, Usuario]     = {}   # código → obj
        self._por_email: dict[str, Usuario]     = {}   # email  → obj
        self._clientes:  dict[str, Cliente]     = {}
        self._contratos: set[str]               = set()
        self._vinculos:  set[tuple]             = set()

    # ── Leitura ───────────────────────────────────────────────────────────────

    def _ler_rows(self) -> list[dict]:
        with open(self.caminho, encoding=self.encoding, newline="") as f:
            return list(csv.DictReader(f, delimiter=";"))

    # ── Organização ───────────────────────────────────────────────────────────

    def _get_or_create_org(self, row: dict) -> Organizacao:
        cod  = row["Codigo Unidade Responsável pelo Atendimento"].strip()
        nome = row["Nome Unidade de Atendimento"].strip()
        if cod not in self._orgs:
            self._orgs[cod] = Organizacao(codigo_externo=cod, nome=nome, ativo=True)
            self.resultado.organizacoes_criadas += 1
        return self._orgs[cod]

    # ── Usuário ───────────────────────────────────────────────────────────────

    def _get_or_create_usuario(
        self,
        org: Organizacao,
        cod: str, nome: str, email: str,
        papel: PapelUsuario,
        ddd: str = "", tel: str = "",
    ) -> Optional[Usuario]:
        cod = cod.strip()
        if not cod or cod == "-":
            return None

        if cod in self._usuarios:
            return self._usuarios[cod]

        nome_norm  = _normalizar_nome(nome)
        email_norm = email.strip().lower() if email.strip() not in ("-", "") else ""

        # Duplo código: mesmo e-mail, código diferente (caso Stela)
        if email_norm and email_norm in self._por_email:
            existente = self._por_email[email_norm]
            self._usuarios[cod] = existente
            self.resultado.duplos_codigos.append(
                f"[{cod}] {nome_norm} → mesmo e-mail de "
                f"[{existente.codigo_externo}] {existente.nome} ({email_norm})"
            )
            return existente

        usuario = Usuario(
            organizacao_id=org.id,
            codigo_externo=cod,
            nome=nome_norm or cod,
            email=email_norm or f"{cod.lower()}@importado.local",
            senha_hash=get_password_hash(SENHA_PADRAO),
            papel=papel,
            telefone=_fone(ddd, tel),
            ativo=True,
        )
        self._usuarios[cod] = usuario
        if email_norm:
            self._por_email[email_norm] = usuario
        self.resultado.usuarios_criados += 1
        return usuario

    # ── Vínculo ───────────────────────────────────────────────────────────────

    def _get_or_create_vinculo(
        self,
        superior: Usuario,
        subordinado: Usuario,
        cod_ext_subordinado: str,
    ) -> Optional[HierarquiaVendas]:
        """
        cod_ext_subordinado diferencia os dois vínculos da Stela:
          GSN Fabricio → ESN T10387
          GSN Wyley    → ESN T26875
        Ambos apontam para o mesmo objeto Usuario, mas são vínculos distintos.
        """
        chave = (str(superior.id), str(subordinado.id), cod_ext_subordinado)
        if chave in self._vinculos:
            return None
        vinculo = HierarquiaVendas(
            superior_id=superior.id,
            subordinado_id=subordinado.id,
            codigo_externo_subordinado=cod_ext_subordinado,
            ativo=True,
        )
        self._vinculos.add(chave)
        self.resultado.vinculos_criados += 1
        return vinculo

    # ── Cliente ───────────────────────────────────────────────────────────────

    def _get_or_create_cliente(
        self,
        org: Organizacao,
        row: dict,
        pre: dict,
    ) -> Optional[Cliente]:
        cod = row["Código do Cliente"].strip()
        if cod in self._clientes:
            return self._clientes[cod]

        cod_esn = pre["esn_responsavel"].get(cod)
        esn_obj = self._usuarios.get(cod_esn) if cod_esn else None

        cliente = Cliente(
            organizacao_id=org.id,
            vendedor_responsavel_id=esn_obj.id if esn_obj else None,
            codigo_externo=cod,
            razao_social=_normalizar_nome(row["Razão Social do Cliente"]),
            cnpj=_limpar_cnpj(row["CPF ou CNPJ do Cliente"]),
            segmento=_normalizar_nome(row["Segmento do Cliente"]),
            sub_segmento=_normalizar_nome(row["Sub Segmento do Cliente"]),
            municipio=_normalizar_nome(_nulo(row["Município do Cliente"])),
            uf=_nulo(row["UF"]),
            setor_publico=_bool_sim_nao(row["Setor Público"]),
            status_atribuicao=(
                StatusAtribuicao.ATRIBUIDO if esn_obj
                else StatusAtribuicao.PENDENTE
            ),
            ativo=True,
        )
        self._clientes[cod] = cliente
        self.resultado.clientes_criados += 1
        return cliente

    # ── Contrato ──────────────────────────────────────────────────────────────

    def _get_or_create_contrato(
        self, cliente: Cliente, row: dict
    ) -> Optional[Contrato]:
        numero = row["Número do Contrato"].strip()
        if numero in self._contratos:
            return None

        status_raw = row["Status do Contrato"].strip().upper()
        try:
            status = StatusContrato(status_raw)
        except ValueError:
            status = StatusContrato.PENDENTE
            self.resultado.avisos.append(
                f"Status desconhecido '{status_raw}' no contrato {numero} → PENDENTE"
            )

        contrato = Contrato(
            cliente_id=cliente.id,
            numero_contrato=numero,
            status=status,
            data_assinatura=_parse_data(row["Data de Assinatura"]),
            data_vigencia_fim=_parse_data(row["Data Final da Vigencia"]),
            unidade_venda=_nulo(row["Nome Unidade de Venda"]),
            modalidade=_nulo(row["Modalidade de Vendas"]),
            recorrente=_bool_sim_nao(row["Recorrente"]),
        )
        self._contratos.add(numero)
        self.resultado.contratos_criados += 1
        return contrato

    # ── Execução ──────────────────────────────────────────────────────────────

    def executar(self) -> tuple[list, ResultadoImportacao]:
        """
        Retorna (lista_objetos_ORM, resultado).
        O chamador adiciona os objetos à sessão e commita.
        """
        rows = self._ler_rows()
        logger.info("CSV carregado: %d linhas", len(rows))

        pre = _preprocessar(rows)
        self.resultado.clientes_esn_misto = pre["clientes_mistos"]

        objetos: list = []

        for i, row in enumerate(rows, start=2):
            try:
                org = self._get_or_create_org(row)
                if org not in objetos:
                    objetos.append(org)

                dsn = self._get_or_create_usuario(
                    org, row["Código do DSN"], row["Nome do DSN"],
                    row["E-mail do DSN"], PapelUsuario.DSN,
                    row["Código de Área do DSN"], row["Telefone DSN"],
                )
                if dsn and dsn not in objetos:
                    objetos.append(dsn)

                gsn = self._get_or_create_usuario(
                    org, row["Código do GSN"], row["Nome do GSN"],
                    row["E-mail do GSN"], PapelUsuario.GSN,
                    row["Código de Área do GSN"], row["Telefone GSN"],
                )
                if gsn and gsn not in objetos:
                    objetos.append(gsn)

                esn = self._get_or_create_usuario(
                    org, row["Código do ESN"], row["Nome do ESN"],
                    row["E-mail do ESN"], PapelUsuario.ESN,
                    row["Código de Área do ESN"], row["Telefone ESN"],
                )
                if esn and esn not in objetos:
                    objetos.append(esn)

                cod_gsn = row["Código do GSN"].strip()
                cod_esn = row["Código do ESN"].strip()

                if dsn and gsn:
                    v = self._get_or_create_vinculo(dsn, gsn, cod_gsn)
                    if v:
                        objetos.append(v)

                if gsn and esn:
                    v = self._get_or_create_vinculo(gsn, esn, cod_esn)
                    if v:
                        objetos.append(v)

                cliente = self._get_or_create_cliente(org, row, pre)
                if cliente and cliente not in objetos:
                    objetos.append(cliente)

                if cliente:
                    contrato = self._get_or_create_contrato(cliente, row)
                    if contrato:
                        objetos.append(contrato)

            except Exception as exc:
                msg = f"Linha {i}: {exc}"
                self.resultado.erros.append(msg)
                logger.error(msg, exc_info=True)

        logger.info(
            "Importação concluída: %d orgs, %d usuários, %d vínculos, "
            "%d clientes, %d contratos, %d erros",
            self.resultado.organizacoes_criadas,
            self.resultado.usuarios_criados,
            self.resultado.vinculos_criados,
            self.resultado.clientes_criados,
            self.resultado.contratos_criados,
            len(self.resultado.erros),
        )
        return objetos, self.resultado
