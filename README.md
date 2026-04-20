# agent-chat-ui (fork LLM Chat)

**Status atual:** Ainda estou trabalhando nisso.  

---

### O que é

Este é um fork simples do agent-chat-ui modificado para rodar **LLMs** em vez de agentes.

Quando combinado com o [llm_router](https://github.com/MatthewJesus7/llm_router), você consegue rotear **automaticamente ou manualmente qualquer IA** que quiser.

### Por que isso existe

A maioria das ferramentas de chat com IA já existentes:
- Exige UIs super bonitinhas
- Não deixa você adicionar qualquer modelo novo da sua escolha
- No final te força a pagar o SaaS deles

Aqui é diferente:
- Você coloca **qualquer API** no backend (`llm_router`)
- O frontend só consome o que você configurou
- É 100% seu
- Histórico fica **exclusivamente no cache do navegador** (nem eu tenho acesso aos seus dados)

---

### Como usar

```bash
# 1. Clone o frontend (branch correta)
git clone -b llm-chat-ui https://github.com/MatthewJesus7/agent-chat-ui.git
cd agent-chat-ui

npm install
npm run dev
Bash# 2. Clone o backend (llm_router)
git clone -b use_in_projects https://github.com/MatthewJesus7/llm_router.git
# Siga o README do llm_router para configurar
```

Depois de rodar os dois, o chat já consegue trocar de modelo na hora usando qualquer provider que você adicionar no backend.
