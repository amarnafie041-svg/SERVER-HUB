import { Router, type IRouter } from "express";
import { Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { logger } from "../lib/logger";
import { execSync } from "child_process";

const router: IRouter = Router();

// Get hosting status
router.get("/hosting/status", authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const username = (req as any).user?.username || "";
    const baseDomain = process.env.BASE_DOMAIN || "server.app";

    res.json({
      username,
      port: parseInt(process.env.PORT || "3001"),
      subdomain: `${username}.${baseDomain}`,
      status: "running",
      urls: {
        local: `http://localhost:${process.env.PORT || "3001"}`,
        subdomain: `https://${username}.${baseDomain}`,
        direct: `/~${username}`,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to get hosting status");
    res.status(500).json({ error: "Failed to get hosting status" });
  }
});

// Get supported languages
router.get("/hosting/languages", authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    let pythonVersion = "Not installed";
    let phpVersion = "Not installed";
    let nodeVersion = "Not installed";
    let npmVersion = "Not installed";

    try { pythonVersion = execSync("python3 --version 2>&1").toString().trim(); } catch {}
    try { phpVersion = execSync("php --version 2>&1").toString().split("\n")[0].trim(); } catch {}
    try { nodeVersion = execSync("node --version 2>&1").toString().trim(); } catch {}
    try { npmVersion = execSync("npm --version 2>&1").toString().trim(); } catch {}

    res.json({
      languages: [
        {
          name: "Python",
          command: "python3",
          version: pythonVersion,
          color: "#3776AB",
          extensions: [".py"],
          packageManager: "pip",
          installCmd: "pip install",
          runCmd: "python3",
        },
        {
          name: "PHP",
          command: "php",
          version: phpVersion,
          color: "#777BB4",
          extensions: [".php"],
          packageManager: "composer",
          installCmd: "composer install",
          runCmd: "php",
        },
        {
          name: "Node.js",
          command: "node",
          version: nodeVersion,
          color: "#339933",
          extensions: [".js", ".ts", ".jsx", ".tsx"],
          packageManager: "npm",
          installCmd: "npm install",
          runCmd: "node",
        },
        {
          name: "Bash",
          command: "bash",
          version: "Bash",
          color: "#4EAA25",
          extensions: [".sh", ".bash"],
          packageManager: "N/A",
          installCmd: "N/A",
          runCmd: "bash",
        },
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to get languages");
    res.status(500).json({ error: "Failed to get languages" });
  }
});

// Get project templates
router.get("/hosting/templates", authenticate, async (_req: Request, res: Response): Promise<void> => {
  res.json({
    templates: [
      {
        id: "python-flask",
        name: "Python Flask App",
        description: "Simple Flask web application",
        language: "python",
        installCmd: "pip install flask",
        runCmd: "python3 app.py",
        files: {
          "app.py": "from flask import Flask\napp = Flask(__name__)\n\n@app.route('/')\ndef home():\n    return 'Hello from Flask!'\n\nif __name__ == '__main__':\n    app.run(host='0.0.0.0', port=8080)\n",
        },
      },
      {
        id: "python-fastapi",
        name: "Python FastAPI",
        description: "FastAPI web application",
        language: "python",
        installCmd: "pip install fastapi uvicorn",
        runCmd: "python3 main.py",
        files: {
          "main.py": "from fastapi import FastAPI\napp = FastAPI()\n\n@app.get('/')\ndef read_root():\n    return {'Hello': 'World'}\n\nif __name__ == '__main__':\n    import uvicorn\n    uvicorn.run(app, host='0.0.0.0', port=8000)\n",
        },
      },
      {
        id: "php-basic",
        name: "PHP Basic Site",
        description: "Simple PHP website",
        language: "php",
        installCmd: "N/A",
        runCmd: "php -S 0.0.0.0:8080",
        files: {
          "index.php": "<?php\n$title = 'My PHP Site';\n?>\n<!DOCTYPE html>\n<html>\n<head><title><?= $title ?></title></head>\n<body>\n<h1>Hello from PHP!</h1>\n</body>\n</html>\n",
        },
      },
      {
        id: "node-express",
        name: "Node.js Express",
        description: "Express.js web application",
        language: "nodejs",
        installCmd: "npm install express",
        runCmd: "node server.js",
        files: {
          "server.js": "const express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.send('Hello from Express!'));\napp.listen(3000, '0.0.0.0', () => console.log('Server running on port 3000'));\n",
        },
      },
    ],
  });
});

export default router;
