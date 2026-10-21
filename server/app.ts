import "dotenv/config";
import express from "express";
import path from "path";
import { whiteVisionApiMiddleware } from "./localApiPlugin.ts";

const app = express();
const distPath = path.resolve(process.cwd(), "dist");

app.disable("x-powered-by");
app.use(whiteVisionApiMiddleware);
app.use(express.static(distPath, { index: false }));
app.get("*", (_req, res, next) => {
  res.sendFile(path.join(distPath, "index.html"), (error) => {
    if (error) next(error);
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Portal White Vision disponível na porta ${port}.`);
});
