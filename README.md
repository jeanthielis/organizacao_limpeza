ControlPoint - Sistema de Acompanhamento de Metas para Equipes
Descrição
O ControlPoint é uma aplicação web desenvolvida para gerenciar e acompanhar o cumprimento de metas de limpeza e organização por equipes. O sistema permite registrar verificações diárias, acompanhar o progresso em tempo real, gerar relatórios detalhados e visualizar rankings de desempenho entre as equipes.

Funcionalidades Principais
🎯 Controle de Metas
Ajuste dinâmico de metas: Controle deslizante para definir a meta de desempenho (0-100%)

Barra de progresso visual: Exibe o progresso atual em relação à meta estabelecida

Status da meta: Indicação clara se a meta foi atingida ou não

👥 Gerenciamento de Equipes
Suporte para 4 equipes diferentes

Interface intuitiva para alternar entre equipes

Dados armazenados separadamente para cada equipe

📋 Sistema de Verificação
16 pontos de verificação com descrições específicas:

Sala de Tonalidade L4

Sala de Padrões L4

Área da Qualitron L4

Área de Inspeção L4

Área de Retido L4

Antigo Falcon L4

Deformação L4/L5

Sala de Tonalidade L5/L6

Sala de Padrões L5/L6

Área da Qualitron L5

Área de Inspeção L5/L6

Área de Retido L5

Área da Qualitrons L6

Cavaletes de Empeno

Área de Retido L6

Deformação L6

📊 Relatórios e Análises
Relatório Diário: Desempenho por data específica

Relatório Mensal: Média de desempenho durante o mês

Ranking Geral: Classificação histórica de todas as equipes

Relatório Combinado: Mensal + Ranking (ideal para impressão)

💾 Histórico e Armazenamento
Histórico completo: Todas as verificações salvas com data

Edição de registros: Possibilidade de editar verificações passadas

Exclusão segura: Controle para remover registros específicos

🔄 Importação/Exportação
Exportação CSV: Download dos dados em formato CSV

Importação CSV: Carregamento de dados a partir de arquivos CSV

Backup automático: Dados salvos no localStorage do navegador

🖨️ Funcionalidades de Impressão
Captura de tela: Salvar relatório como imagem PNG

Impressão otimizada: Layout especial para impressão física

Gráficos incluídos: Visualizações mantidas na impressão

Tecnologias Utilizadas
HTML5: Estrutura da aplicação

CSS3: Estilização com variáveis CSS e design responsivo

JavaScript: Lógica de aplicação e interatividade

Chart.js: Gráficos e visualizações de dados

Font Awesome: Ícones e elementos visuais

html2canvas: Captura de tela para exportação

Chart.js Datalabels: Plugin para labels em gráficos

Como Usar
1. Primeiro Acesso
Abra o arquivo organizacao_limpeza.html em um navegador web

O sistema carregará automaticamente com a data atual

2. Realizar Verificação Diária
Selecione a equipe desejada

Verifique os pontos de limpeza concluídos

Ajuste a meta se necessário

Clique em "Salvar Verificação"

3. Gerar Relatórios
Selecione o tipo de relatório (Diário, Mensal, Ranking ou Combinado)

Escolha a equipe ou "Todas as Equipes"

Defina o período (data ou mês)

Clique em "Gerar Relatório"

4. Exportar Dados
CSV: Use "Exportar para CSV" para backup

Imagem: Use "Tirar Print" para salvar como PNG

Impressão: Use "Imprimir Relatório" para versão física

Estrutura de Dados
Armazenamento Local
Os dados são salvos no localStorage com a chave:

text
checkpoints_[NOME_EQUIPE]_[DATA]
Exemplo: checkpoints_Equipe 1_2024-01-15

Formato CSV para Importação
text
Equipe,Data,Pontos_Concluidos
Equipe 1,2024-01-15,12
Equipe 2,2024-01-15,14
Personalização
Ajuste de Metas
Use o controle deslizante na seção de progresso

Meta padrão: 93%

Range disponível: 0% a 100%

Modo de Impressão
Layout otimizado para impressão

Remove elementos não essenciais

Mantém gráficos e tabelas

Compatibilidade
✅ Navegadores modernos (Chrome, Firefox, Safari, Edge)

✅ Dispositivos móveis (design responsivo)

✅ Funciona offline (após carregamento inicial)

Desenvolvimento
Estrutura de Arquivos
text
organizacao_limpeza.html  # Arquivo principal
Dependências Externas
Font Awesome 6.4.0

Chart.js 3.x

html2canvas 1.4.1

Chart.js Datalabels 2.x

Manutenção
Backup de Dados
Exporte regularmente para CSV

Os dados ficam armazenados no navegador do usuário

Atualizações
Substitua o arquivo HTML para atualizar a aplicação

Os dados existentes serão mantidos no localStorage

Suporte
Para questões ou sugestões, entre em contato com a equipe de desenvolvimento.

ControlPoint - Simplificando o acompanhamento de metas de limpeza e organização.