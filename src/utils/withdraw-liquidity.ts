import {
  ApiV3PoolInfoStandardItemCpmm,
  CpmmKeys,
  Percent,
} from "@raydium-io/raydium-sdk-v2";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import fs from "fs";
import path from "path";
import { connection, initSdk, txVersion } from "../config";
import { percentWithdraw, withdrawSlippage } from "../constants/constants";

export const withdraw = async () => {
  try {
    const poolInfoPath = path.join(__dirname, "../../poolInfo.json");
    if (!fs.existsSync(poolInfoPath)) {
      throw new Error(
        "poolInfo.json not found. Please create a pool and add liquidity first."
      );
    }

    const parsedPoolInfo = JSON.parse(fs.readFileSync(poolInfoPath, "utf-8"));
    const poolId = parsedPoolInfo.poolId; // Use the pool ID from your created pool
    const raydium = await initSdk();
    // SOL - USDC pool
    let poolInfo: ApiV3PoolInfoStandardItemCpmm;
    let poolKeys: CpmmKeys | undefined;

    const data = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    poolInfo = data.poolInfo;
    poolKeys = data.poolKeys;

    const slippage = new Percent(withdrawSlippage, 100); // 1%

    const ataAddress = getAssociatedTokenAddressSync(
      new PublicKey(poolInfo.lpMint.address),
      raydium.ownerPubKey
    );

    const userLPBalance = await connection.getTokenAccountBalance(ataAddress);
    const lpAmount =
      (percentWithdraw / 100) * Number(userLPBalance.value.amount);

    const { execute } = await raydium.cpmm.withdrawLiquidity({
      poolInfo,
      poolKeys,
      lpAmount: new BN(lpAmount),
      txVersion,
      slippage,

      // closeWsol: false, // default if true, if you want use wsol, you need set false

      // optional: set up priority fee here
      // computeBudgetConfig: {
      //   units: 600000,
      //   microLamports: 46591500,
      // },
      // optional: add transfer sol to tip account instruction. e.g sent tip to jito
      // txTipConfig: {
      //   address: new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
      //   amount: new BN(10000000), // 0.01 sol
      // },
    });

    // don't want to wait confirm, set sendAndConfirm to false or don't pass any params to execute
    const { txId } = await execute({ sendAndConfirm: true });
    console.log("pool withdraw:", {
      txId: `https://explorer.solana.com/tx/${txId}`,
    });
  } catch (error) {
    console.log(error);
  }
};

/** uncomment code below to execute */
// withdraw()
