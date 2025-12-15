const axios = require('axios');
const logger = require('../utils/logger');
const integrationUtils = require('./integrationUtils');
const User = require('../models/User');

class PipefyService {
  // === Pipefy Integration ===
  createPipefyCard = async (leadData, userSettings) => {
    const config = thintegrationUtilsis._getApiConfig('pipefy', userSettings);
    const api = axios.create({
        baseURL: 'https://api.pipefy.com/graphql',
        headers: { 'Authorization': `Bearer ${config.apiKey}` }
    });

    const mutation = `
        mutation($input: CreateCardInput!) {
            createCard(input: $input) {
                card {
                    id
                    title
                }
            }
        }
    `;

    const fields_attributes = [];
    if (config.fieldMappings && Array.isArray(config.fieldMappings)) {
        config.fieldMappings.forEach(mapping => {
            const value = leadData[mapping.qualifaiField];
            if (mapping.qualifaiField && mapping.pipefyFieldId && value !== null && value !== undefined) {
                fields_attributes.push({
                    field_id: mapping.pipefyFieldId,
                    value: String(value)
                });
            }
        });
    }

    const variables = {
        input: {
            pipe_id: config.pipelineId,
            title: `${leadData.name} - ${leadData.company}`,
            fields_attributes: fields_attributes
        }
    };

    const response = await api.post('', { query: mutation, variables });

    if (response.data.errors) {
        const rawErrorMessage = JSON.stringify(response.data.errors);
        logger.error('[Pipefy] Erro ao criar card:', rawErrorMessage);

        if (rawErrorMessage.includes("Field is not defined on FieldValueInput") || rawErrorMessage.includes("was provided invalid value")) {
            const detailedError = `🛑 **Erro Crítico na Integração com Pipefy** 🛑

A API do Pipefy retornou um erro que, apesar de genérico, quase sempre significa uma de duas coisas:

1.  **ID de Campo Inválido:** Um dos IDs de campo que você mapeou (ex: \`nome\`, \`email\`) está incorreto ou não existe no pipeline **${config.pipelineId}**.
*   **Ação:** Verifique CADA ID no seu mapeamento. Para encontrar o ID correto, edite o campo no formulário do Pipefy e copie o ID que aparece.

2.  **TIPO DE CAMPO Incompatível (Causa mais provável):** Você está enviando um valor de texto (ex: "novo") para um campo no Pipefy que **NÃO é do tipo "Texto Curto"**. Isso é muito comum com campos como "Status" ou "Origem".
*   **Exemplo:** Se o seu campo "Status" no Pipefy for uma **Seleção Única (Dropdown)**, você **NÃO PODE** enviar o texto "novo". Você **PRECISA** enviar o **ID da opção "novo"**.
*   **Ação:** Verifique o **TIPO** de cada campo que você mapeou no Pipefy.
    *   Se for **Texto Curto, Texto Longo, Email, Telefone**: Está correto.
    *   Se for **Seleção Única, Múltipla Escolha, Etiqueta, Assignee**: Você **PRECISA** usar os **IDs das opções**, não o texto. Edite o campo no Pipefy para encontrar os IDs de cada opção.

**Recomendação:** Use a nova ferramenta "Testar Conexão e Buscar Campos" na tela de configurações para verificar todos os IDs e tipos de campos do seu pipeline.

--- Erro original da API: ---\n${rawErrorMessage}`;
            throw new Error(detailedError);
        }

        throw new Error(`Erro no Pipefy: ${rawErrorMessage}`);
    }

    const cardId = response.data.data.createCard.card.id;
    logger.info(`[Pipefy] Card criado: ${cardId}`);
    return { id: cardId, cardId: cardId };
}

getPipefyPipelineFields = async (userSettings) => {
    const config = integrationUtils._getApiConfig('pipefy', userSettings);
    const api = axios.create({
        baseURL: 'https://api.pipefy.com/graphql',
        headers: { 'Authorization': `Bearer ${config.apiKey}` }
    });

    const query = `
        query ($id: ID!) {
            pipe(id: $id) {
                id
                name
                start_form_fields {
                    id
                    label
                    type
                }
                phases {
                    name
                    fields {
                        id
                        label
                        type
                    }
                }
            }
        }
    `;
    const variables = { id: config.pipelineId };

    const response = await api.post('', { query, variables });

    if (response.data.errors) {
        throw new Error('Erro ao buscar campos do Pipefy. Verifique o ID do Pipeline e sua API Key.');
    }
    const pipeData = response.data.data.pipe;
    const allFields = [...pipeData.start_form_fields];
    pipeData.phases.forEach(phase => {
        allFields.push(...phase.fields);
    });

    // Remove duplicates by ID
    const uniqueFields = allFields.reduce((acc, current) => {
        if (!acc.find(item => item.id === current.id)) {
            acc.push(current);
        }
        return acc;
    }, []);

    return uniqueFields.map(field => ({
        id: field.id,
        label: field.label,
        type: field.type
    }));
}


}

module.exports = new PipefyService();
