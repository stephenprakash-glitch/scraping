const dotenv = require("dotenv");
const app = require("./app");

dotenv.config();

const PORT = process.env.PORT || 3010;

app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
});

