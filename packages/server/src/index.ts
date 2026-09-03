import "dotenv/config";
import { createApp, DEFAULT_PORT } from "./app.js";

const port = Number(process.env.PORT) || DEFAULT_PORT;
const app = createApp();
app.listen(port, () => {
  console.log(`http://127.0.0.1:${port}`);
});
