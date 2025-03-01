import * as readline from "readline";
import { createToken } from "./utils/create-token";
import { createPool } from "./utils/create-pool";
import { withdraw } from "./utils/withdraw-liquidity";

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("=== AMM POOL WITH TOKEN 22 ===");

  while (true) {
    console.log("Choose an option:");
    console.log("1. Create Token");
    console.log("2. Add Liquidity");
    console.log("3. Remove Liquidity");
    console.log("4. Exit");

    try {
      const choice = await askQuestion(rl, "Enter your choice: ");

      if (choice === "4") {
        break;
      }

      switch (choice) {
        case "1":
          await createToken();
          break;
        case "2":
          await createPool();
          break;
        case "3":
          await withdraw();
          break;
        default:
          console.log("Invalid choice.");
      }
    } catch (error) {
      const err = error as Error;
      console.error("Error:", err.message);
    }
  }

  rl.close();
}

// Helper for asking questions
function askQuestion(rl: readline.Interface, query: string) {
  return new Promise((resolve) => rl.question(query, resolve));
}

main();
