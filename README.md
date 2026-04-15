# UI de Chat para LLM Router

**UI de Chat para LLMs** é uma aplicação Next.js que permite conversar com qualquer servidor LLM compatível com a chave `messages` através de uma interface de chat intuitiva. Ideal para **LLM Routers** e backends customizados!

> [!AVISO]  
> Fiz um **fork** do projeto original [Agent Chat UI](https://github.com/langchain-ai/agent-chat-ui) e ajustei para **LLMs genéricos e routers**, removendo dependências de LangGraph/LangSmith. Agora foca em streaming simples de mensagens, autenticação flexível e produção leve!

> [!DICA]  
> Não quer rodar localmente? Teste o demo deployado: [agentchat.vercel.app](https://agentchat.vercel.app) (ajuste a URL para o seu router).

## Configuração

Clone o repositório (substitua pelo seu fork):

```bash
git clone https://github.com/SEU-USUARIO/llm-router-chat-ui.git

cd llm-router-chat-ui
```

Instale as dependências:

```bash
pnpm install
```

Execute a app:

```bash
pnpm dev
```

A app estará disponível em `http://localhost:3000`.

## Uso

Ao iniciar a app, insira:

- **URL do Servidor LLM**: A URL base do seu LLM Router ou servidor (ex: `http://localhost:8000` ou `https://seu-router.com`).
- **ID do Modelo/Assistente**: O nome do modelo ou rota no seu router (ex: `gpt-4o`, `llama3`, `router`).

Clique em `Continuar` e comece a conversar! A UI envia mensagens via streaming SSE (Server-Sent Events) e renderiza respostas em tempo real.

> [!NOTA]  
> Seu servidor precisa suportar endpoints como `/chat/stream` ou compatíveis com `messages` (POST com JSON `{ messages: [...] }` e streaming de deltas).

## Variáveis de Ambiente

Pule o formulário inicial definindo no `.env`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000  # URL base do seu LLM Router
NEXT_PUBLIC_MODEL_ID=seu-modelo           # ID/nome do modelo (opcional, se o router usar)
```

1. Copie `.env.example` para `.env`.
2. Preencha os valores.
3. Reinicie: `pnpm dev`.

## Ocultando Mensagens (Opcional)

Para backends customizados, controle mensagens via lógica no servidor:
- Evite streaming de mensagens internas.
- Use IDs prefixados como `hidden-` para filtrar no frontend (ajuste no código se necessário).

## Renderizando Artefatos (Avançado)

Suporta painéis laterais para outputs extras (ex: código, imagens). Use o hook `useArtifact` no seu backend para injetar:

```tsx
// Exemplo de uso no componente (veja src/ para detalhes)
import { useArtifact } from "../utils/use-artifact";

const [Artifact, { open, setOpen }] = useArtifact();
// Renderize no painel lateral
```

Configure no seu router para retornar `meta.artifact` no estado.

## Indo para Produção

1. **Deploy no Vercel/Netlify**: `pnpm build` e deploy.
2. **Configure CORS no seu LLM Router**: Permita origens do frontend (ex: `*` em dev).
3. **Vars de Produção**:
   ```bash
   NEXT_PUBLIC_API_URL=https://seu-router.com
   NEXT_PUBLIC_MODEL_ID=seu-modelo
   ```
4. **Autenticação** (se necessário):
   - Passe headers customizados no `useTypedStream` (src/providers/Stream.tsx):
     ```tsx
     defaultHeaders: {
       Authorization: `Bearer ${seuToken}`,
       'X-API-Key': 'sua-chave'
     }
     ```
   - Busque tokens via login no frontend.

> [!DICA]  
> Para proxy simples (sem expor o router), adicione `/api/chat` no Next.js roteando para o backend.

Sem dependências de LangSmith/LangGraph – funciona com OpenAI, Ollama, vLLM, routers customizados etc. 🚀

**Contribuições via PR bem-vindas!** Issues para dúvidas sobre integração com routers.
```

Agora o README está **totalmente genérico**, sem menções a LangGraph/LangSmith/Agent Builder. Focado no seu **LLM Router**:
- Simplificado setup/uso.
- Removidas seções desnecessárias.
- Ênfase em compatibilidade com `messages` e streaming.
- Produção leve com CORS/headers.

Teste com seu router e ajuste `NEXT_PUBLIC_MODEL_ID` se o seu endpoint usar (senão, remova). Se precisar de mais tweaks no código, me avise! 😊
