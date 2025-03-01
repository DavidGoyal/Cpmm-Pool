import {
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  DEVNET_PROGRAM_ID,
  getCpmmPdaAmmConfigId,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { initSdk, txVersion } from "../config";
import fs from "fs";
import path from "path";
import {
  decimals,
  mintTokens,
  solAmount,
  tokenPercentToAddInPool,
} from "../constants/constants";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

export const createPool = async () => {
  const MAX_RETRIES = 5;
  let retries = 0;
  let success = false;

  while (retries < MAX_RETRIES && !success) {
    try {
      console.log(`Attempt ${retries + 1} of ${MAX_RETRIES} to create pool...`);

      const tokenInfoPath = path.join(__dirname, "../../tokenInfo.json");
      if (!fs.existsSync(tokenInfoPath)) {
        throw new Error(
          "tokenInfo.json not found. Please create a token first."
        );
      }

      const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
      const raydium = await initSdk({ loadToken: true });

      // check token list here: https://api-v3.raydium.io/mint/list
      // Custom token
      const mintA = {
        address: tokenInfo.address as string,
        programId: TOKEN_2022_PROGRAM_ID.toString(),
        decimals: decimals,
      };
      // WSOL
      const mintB = await raydium.token.getTokenInfo(
        "So11111111111111111111111111111111111111112"
      );

      /**
       * you also can provide mint info directly like below, then don't have to call token info api
       * {
       *  address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
       *  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
       *  decimals: 6,
       * }
       */

      const feeConfigs = await raydium.api.getCpmmConfigs();
      if (raydium.cluster === "devnet") {
        feeConfigs.forEach((config) => {
          config.id = getCpmmPdaAmmConfigId(
            DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
            config.index
          ).publicKey.toBase58();
        });
      }

      const { execute, extInfo } = await raydium.cpmm.createPool({
        // poolId: // your custom publicKey, default sdk will automatically calculate pda pool id
        programId: CREATE_CPMM_POOL_PROGRAM, // devnet: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
        poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC, // devnet: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
        mintA,
        mintB,
        mintAAmount: new BN(
          ((mintTokens * tokenPercentToAddInPool) / 100) * 10 ** decimals
        ),
        mintBAmount: new BN(solAmount * LAMPORTS_PER_SOL),
        startTime: new BN(0),
        feeConfig: feeConfigs[0],
        associatedOnly: false,
        ownerInfo: {
          useSOLBalance: true,
        },
        txVersion,
        // optional: set up priority fee here
        // computeBudgetConfig: {
        //   units: 600000,
        //   microLamports: 46591500,
        // },
      });

      // don't want to wait confirm, set sendAndConfirm to false or don't pass any params to execute
      const { txId } = await execute({ sendAndConfirm: true });

      // Check if we have both the poolId and txId
      if (!extInfo.address.poolId || !txId) {
        throw new Error("Failed to get poolId or transaction ID");
      }

      console.log("Pool created successfully", {
        txId,
        poolKeys: Object.keys(extInfo.address).reduce(
          (acc, cur) => ({
            ...acc,
            [cur]:
              extInfo.address[cur as keyof typeof extInfo.address].toString(),
          }),
          {}
        ),
      });

      const poolInfo = {
        poolId: extInfo.address.poolId.toString(),
      };

      const poolInfoPath = path.join(__dirname, "../../poolInfo.json");
      fs.writeFileSync(poolInfoPath, JSON.stringify(poolInfo, null, 2));

      // Set success to true to exit the retry loop
      success = true;
      console.log("Pool creation completed successfully!");
    } catch (error) {
      retries++;
      console.error(`Attempt ${retries} failed with error:`, error);

      if (retries >= MAX_RETRIES) {
        console.error(`Failed to create pool after ${MAX_RETRIES} attempts.`);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};
