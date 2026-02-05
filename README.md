# Research Orchestration Cockpit (ROC)

科研编排与执行驾驶舱 - 面向 LLM/深度学习科研的完整闭环系统

## 功能特性

- **AI 驱动的计划生成**: 基于研究目标自动生成实验计划
- **多集群支持**: 支持 Slurm、Kubernetes 和 SSH 集群
- **实验追踪集成**: 集成 MLflow、Wandb 和 TensorBoard
- **实时监控**: 运行状态监控和异常告警
- **自动报告生成**: LaTeX 报告自动生成和 PDF 编译

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 8
- PostgreSQL >= 15
- Redis >= 7

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd research-orchestration-cockpit

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 运行数据库迁移
pnpm db:migrate

# 启动开发服务器
pnpm dev
```

### Docker 部署

```bash
cd docker
docker-compose up -d
```

服务将在以下端口启动:
- UI: http://localhost:5173
- API: http://localhost:3000
- MLflow: http://localhost:5000
- MinIO Console: http://localhost:9001

## 项目结构

```
research-orchestration-cockpit/
├── packages/
│   ├── core/           # 核心后端服务
│   │   ├── src/
│   │   │   ├── agents/     # AI Agents
│   │   │   ├── api/        # REST API
│   │   │   ├── db/         # 数据库
│   │   │   ├── models/     # 数据模型
│   │   │   ├── services/   # 业务服务
│   │   │   └── utils/      # 工具函数
│   │   └── package.json
│   │
│   └── ui/             # Web 前端
│       ├── src/
│       │   ├── api/        # API 客户端
│       │   ├── components/ # 组件
│       │   └── pages/      # 页面
│       └── package.json
│
├── templates/          # LaTeX 模板
├── docker/             # Docker 配置
└── docs/               # 文档
```

## API 文档

### 项目 API

- `GET /api/projects` - 获取项目列表
- `POST /api/projects` - 创建项目
- `GET /api/projects/:id` - 获取项目详情
- `PATCH /api/projects/:id` - 更新项目
- `DELETE /api/projects/:id` - 删除项目

### 实验 API

- `GET /api/experiments` - 获取实验列表
- `POST /api/experiments` - 创建实验
- `POST /api/experiments/batch` - 批量创建实验

### 运行 API

- `GET /api/runs` - 获取运行列表
- `GET /api/runs/active` - 获取活跃运行
- `POST /api/runs` - 创建运行
- `POST /api/runs/:id/metrics` - 记录指标
- `POST /api/runs/:id/cancel` - 取消运行

### AI API

- `POST /api/ai/plan` - 生成研究计划
- `POST /api/ai/ablation-plan` - 生成消融计划
- `POST /api/ai/analyze` - 分析实验结果

## 配置

### 环境变量

```bash
# 服务器
SERVER_PORT=3000
SERVER_HOST=0.0.0.0

# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=roc
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# LLM
LLM_PROVIDER=openai  # openai 或 anthropic
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4

# 集群
CLUSTER_TYPE=slurm  # slurm, kubernetes, 或 ssh
SLURM_PARTITION=gpu

# 追踪
MLFLOW_ENABLED=true
MLFLOW_TRACKING_URI=http://localhost:5000
WANDB_ENABLED=false
TENSORBOARD_ENABLED=true
```

## 开发

```bash
# 启动后端开发服务器
pnpm --filter @roc/core dev

# 启动前端开发服务器
pnpm --filter @roc/ui dev

# 运行测试
pnpm test

# 构建
pnpm build
```

## License

MIT
