#  Infinity Cafe Microservices Agentic-RAG

**Infinity Cafe Microservices Agentoc-RAG from Self-hosted AI Starter Kit Based** is an open-source Docker Compose template designed to swiftly initialize a comprehensive local AI and low-code development environment.

![n8n.io - Screenshot](https://raw.githubusercontent.com/n8n-io/self-hosted-ai-starter-kit/main/assets/n8n-demo.gif)

Curated by <https://github.com/n8n-io>, it combines the self-hosted n8n
platform with a curated list of compatible AI products and components to
quickly get started with building self-hosted AI workflows.

> [!TIP]
> [Read the announcement](https://blog.n8n.io/self-hosted-ai/)

### What’s included

✅ [**Self-hosted n8n**](https://n8n.io/) 
   - Low-code platform with over 400 integrations and advanced AI components 
   - http://localhost:5678

✅ [**Ollama**](https://ollama.com/) - Cross-platform LLM platform to install
and run the latest local LLMs

✅ [**Qdrant**](https://qdrant.tech/) - Open-source, high performance vector
store with an comprehensive API http://localhost:6333/dashboard

✅ [**Postgres Vector 17**](https://www.postgresql.org/) -  Workhorse of the Data
Engineering world, handles large amounts of data safely.

✅ [**InitDB**] initial DB infinity cafe

✅ [**pgAdmin**] http://localhost:5050

✅ [**ngrok**] Setup ngrok, plz change in .env ${NG_CRE}, ${NG_URL}

✅  Infinity Cafe Microservices ☕️
Infinity Cafe adalah sistem pemesanan restoran berbasis microservices menggunakan Python + FastAPI + PgVector17 + FastAPI-MCP.

## 📦 Struktur Folder
```
infinity/
├── requirements.txt
├── menu_service/
│   ├── Dockerfile
│   └── main.py
├── order_service/
│   ├── Dockerfile
│   └── main.py
├── kitchen_service/
│   ├── Dockerfile
│   └── main.py
```

### Infinity microservices — local developer quickstart

If you only want to run the backend microservices and frontend included in this repo (without running the full n8n/Ollama stack), use the repository Docker Compose. The compose file exposes each service on its own port and also provides an `initdb` helper that creates and seeds the Postgres databases.

1) Prepare environment

 - Copy the provided `.env` and edit any values you need (database passwords, NGROK domain, etc.).

2) Start core services (Docker + Docker Compose v2)

PowerShell (recommended for Windows):

```powershell
# Start everything (detached)
docker compose up --build -d

# Or start selected services only (example: only backend services)
docker compose up -d menu_service order_service kitchen_service inventory_service report_service user_service gateway frontend pgvector17
```

3) Useful service endpoints (defaults from docker-compose.yml)

 - Menu Service:  http://localhost:8001
 - Order Service: http://localhost:8002
 - Kitchen Service: http://localhost:8003
 - Report Service: http://localhost:8004
 - User Service: http://localhost:8005
 - Inventory Service: http://localhost:8006
 - Frontend (static): http://localhost:7777
 - Gateway: http://localhost:2323
 - n8n (if running): http://localhost:5678
 - pgAdmin: http://localhost:5050
 - Postgres (pgvector): 5555 -> container 5432 (use connection string from `.env`)

4) Run a single Python service for fast iteration (example: inventory)

From a PowerShell shell on your host machine:

```powershell
cd ./infinity/inventory_service
python -m venv .venv           # optional: create venv
.\.venv\Scripts\Activate.ps1
pip install -r ../requirements.txt
# run with reload
uvicorn main:app --host 0.0.0.0 --port 8006 --reload
```

Notes:
 - The services expect the Postgres databases created in the compose `initdb` step. If containers cannot connect, run `docker compose up initdb` first or ensure `pgvector17` is healthy.
 - The `.env` file contains DATABASE_URL_* entries and service URL overrides (MENU_SERVICE_URL, ORDER_SERVICE_URL, etc.). Keep them consistent when running containers vs running locally.

5) Troubleshooting

 - If Postgres containers fail initialization, check `/initdb` seed SQL files in the `initdb/` folder.
 - If a service healthcheck fails, check its logs: `docker compose logs <service>`.
 - For cross-service calls (menu -> inventory), the services use internal Docker DNS names (e.g. `inventory_service:8006`). When testing locally (uvicorn), set the corresponding URL env (e.g. `INVENTORY_SERVICE_URL=http://localhost:8006`).

6) Developer tips

 - Use `docker compose up <service>` to speed up iteration for a small subset of services.
 - To run backend unit tests (if any are added), create a `/tests` folder and run `pytest` from repo root.
 - When changing DB models, re-run `initdb` or apply migrations (migrations are not included by default in this starter).

## **Akses:**
   - Menu Service → [http://localhost:8001](http://localhost:8001)
   - Order Service → [http://localhost:8002](http://localhost:8002)
   - Kitchen Service → [http://localhost:8003](http://localhost:8003)

### What you can build

⭐️ **AI Agents** for scheduling appointments

⭐️ **Summarize Company PDFs** securely without data leaks

⭐️ **Smarter Slack Bots** for enhanced company communications and IT operations

⭐️ **Private Financial Document Analysis** at minimal cost

## Installation

### Cloning the Repository

```bash
git clone https://github.com/AIKABAYAN/infinitycafe.git
cd infinitycafe
```

### Running n8n using Docker Compose

#### For Nvidia GPU users

```
git clone https://github.com/AIKABAYAN/infinitycafe.git
cd infinitycafe
docker compose --profile gpu-nvidia up --build 
```

> [!NOTE]
> If you have not used your Nvidia GPU with Docker before, please follow the
> [Ollama Docker instructions](https://github.com/ollama/ollama/blob/main/docs/docker.md).

### For AMD GPU users on Linux

```
git clone https://github.com/AIKABAYAN/infinitycafe.git
cd infinitycafe
docker compose --profile gpu-amd up --build
```

#### For Mac / Apple Silicon users

If you’re using a Mac with an M1 or newer processor, you can't expose your GPU
to the Docker instance, unfortunately. There are two options in this case:

1. Run the starter kit fully on CPU, like in the section "For everyone else"
   below
2. Run Ollama on your Mac for faster inference, and connect to that from the
   n8n instance

If you want to run Ollama on your mac, check the
[Ollama homepage](https://ollama.com/)
for installation instructions, and run the starter kit as follows:

```
git clone https://github.com/n8n-io/self-hosted-ai-starter-kit.git
cd self-hosted-ai-starter-kit
docker compose up
```

##### For Mac users running OLLAMA locally

If you're running OLLAMA locally on your Mac (not in Docker), you need to modify the OLLAMA_HOST environment variable
in the n8n service configuration. Update the x-n8n section in your Docker Compose file as follows:

```yaml
x-n8n: &service-n8n
  # ... other configurations ...
  environment:
    # ... other environment variables ...
    - OLLAMA_HOST=host.docker.internal:11434
```

Additionally, after you see "Editor is now accessible via: <http://localhost:5678/>":

1. Head to <http://localhost:5678/home/credentials>
2. Click on "Local Ollama service"
3. Change the base URL to "http://host.docker.internal:11434/"

#### For everyone else

```
git clone https://github.com/AIKABAYAN/infinitycafe.git
cd infinitycafe
docker compose --profile cpu up
```

## ⚡️ Quick start and usage

The core of the Self-hosted AI Starter Kit is a Docker Compose file, pre-configured with network and storage settings, minimizing the need for additional installations.
After completing the installation steps above, simply follow the steps below to get started.

1. Open <http://localhost:5678/> in your browser to set up n8n. You’ll only
   have to do this once.
2. Open the included workflow:
   <http://localhost:5678/workflow/srOnR8PAY3u4RSwb>
3. Click the **Chat** button at the bottom of the canvas, to start running the workflow.
4. If this is the first time you’re running the workflow, you may need to wait
   until Ollama finishes downloading Llama3.2. You can inspect the docker
   console logs to check on the progress.

To open n8n at any time, visit <http://localhost:5678/> in your browser.

With your n8n instance, you’ll have access to over 400 integrations and a
suite of basic and advanced AI nodes such as
[AI Agent](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/),
[Text classifier](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.text-classifier/),
and [Information Extractor](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.information-extractor/)
nodes. To keep everything local, just remember to use the Ollama node for your
language model and Qdrant as your vector store.

> [!NOTE]
> This starter kit is designed to help you get started with self-hosted AI
> workflows. While it’s not fully optimized for production environments, it
> combines robust components that work well together for proof-of-concept
> projects. You can customize it to meet your specific needs

## Upgrading

* ### For Nvidia GPU setups:

```bash
docker compose --profile gpu-nvidia pull
docker compose create && docker compose --profile gpu-nvidia up
```

* ### For Mac / Apple Silicon users

```
docker compose pull
docker compose create && docker compose up
```

* ### For Non-GPU setups:

```bash
docker compose --profile cpu pull
docker compose create && docker compose --profile cpu up
```

## 👓 Recommended reading

n8n is full of useful content for getting started quickly with its AI concepts
and nodes. If you run into an issue, go to [support](#support).

- [AI agents for developers: from theory to practice with n8n](https://blog.n8n.io/ai-agents/)
- [Tutorial: Build an AI workflow in n8n](https://docs.n8n.io/advanced-ai/intro-tutorial/)
- [Langchain Concepts in n8n](https://docs.n8n.io/advanced-ai/langchain/langchain-n8n/)
- [Demonstration of key differences between agents and chains](https://docs.n8n.io/advanced-ai/examples/agent-chain-comparison/)
- [What are vector databases?](https://docs.n8n.io/advanced-ai/examples/understand-vector-databases/)

## 🎥 Video walkthrough

- [Installing and using Local AI for n8n](https://www.youtube.com/watch?v=xz_X2N-hPg0)

## 🛍️ More AI templates

For more AI workflow ideas, visit the [**official n8n AI template
gallery**](https://n8n.io/workflows/?categories=AI). From each workflow,
select the **Use workflow** button to automatically import the workflow into
your local n8n instance.

### Learn AI key concepts

- [AI Agent Chat](https://n8n.io/workflows/1954-ai-agent-chat/)
- [AI chat with any data source (using the n8n workflow too)](https://n8n.io/workflows/2026-ai-chat-with-any-data-source-using-the-n8n-workflow-tool/)
- [Chat with OpenAI Assistant (by adding a memory)](https://n8n.io/workflows/2098-chat-with-openai-assistant-by-adding-a-memory/)
- [Use an open-source LLM (via Hugging Face)](https://n8n.io/workflows/1980-use-an-open-source-llm-via-huggingface/)
- [Chat with PDF docs using AI (quoting sources)](https://n8n.io/workflows/2165-chat-with-pdf-docs-using-ai-quoting-sources/)
- [AI agent that can scrape webpages](https://n8n.io/workflows/2006-ai-agent-that-can-scrape-webpages/)

### Local AI templates

- [Tax Code Assistant](https://n8n.io/workflows/2341-build-a-tax-code-assistant-with-qdrant-mistralai-and-openai/)
- [Breakdown Documents into Study Notes with MistralAI and Qdrant](https://n8n.io/workflows/2339-breakdown-documents-into-study-notes-using-templating-mistralai-and-qdrant/)
- [Financial Documents Assistant using Qdrant and](https://n8n.io/workflows/2335-build-a-financial-documents-assistant-using-qdrant-and-mistralai/) [Mistral.ai](http://mistral.ai/)
- [Recipe Recommendations with Qdrant and Mistral](https://n8n.io/workflows/2333-recipe-recommendations-with-qdrant-and-mistral/)

## Tips & tricks

### Accessing local files

The self-hosted AI starter kit will create a shared folder (by default,
located in the same directory) which is mounted to the n8n container and
allows n8n to access files on disk. This folder within the n8n container is
located at `/data/shared` -- this is the path you’ll need to use in nodes that
interact with the local filesystem.

**Nodes that interact with the local filesystem**

- [Read/Write Files from Disk](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.filesreadwrite/)
- [Local File Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.localfiletrigger/)
- [Execute Command](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand/)

## 📜 License

This project is licensed under the Apache License 2.0 - see the
[LICENSE](LICENSE) file for details.

## 💬 Support

Join the conversation in the [n8n Forum](https://community.n8n.io/), where you
can:

- **Share Your Work**: Show off what you’ve built with n8n and inspire others
  in the community.
- **Ask Questions**: Whether you’re just getting started or you’re a seasoned
  pro, the community and our team are ready to support with any challenges.
- **Propose Ideas**: Have an idea for a feature or improvement? Let us know!
  We’re always eager to hear what you’d like to see next.
