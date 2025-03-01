import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import {
  createGenericFile,
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import {
  AuthorityType,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  ExtensionType,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  LENGTH_SIZE,
  mintToChecked,
  setAuthority,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  TokenMetadata,
} from "@solana/spl-token-metadata";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import {
  decimals,
  freezeDisabled,
  maxFee,
  metadata,
  mintTokens,
  mintDisabled,
  PRIVATE_KEY,
  RPC_URL,
  txnFee,
  TAX_WALLET_ADDRESS,
} from "../constants/constants";

export const createToken = async () => {
  try {
    const connection = new Connection(RPC_URL);
    const umi = createUmi(RPC_URL)
      .use(mplTokenMetadata())
      .use(
        irysUploader({
          // mainnet address: "https://node1.irys.xyz"
          // devnet address: "https://devnet.irys.xyz"
          address: "https://devnet.irys.xyz",
        })
      );

    const userWallet = umi.eddsa.createKeypairFromSecretKey(
      bs58.decode(PRIVATE_KEY)
    );
    const payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    const authority = createSignerFromKeypair(umi, userWallet);
    umi.use(signerIdentity(authority, true));
    const mint = Keypair.generate();

    const imageFile = fs.readFileSync(path.join(__dirname, "../../token.png"));

    // Use `createGenericFile` to transform the file into a `GenericFile` type
    // that umi can understand. Make sure you set the mimi tag type correctly
    // otherwise Arweave will not know how to display your image.

    const umiImageFile = createGenericFile(imageFile, "0.png", {
      tags: [{ name: "Content-Type", value: "image/png" }],
    });

    // Here we upload the image to Arweave via Irys and we get returned a uri
    // address where the file is located. You can log this out but as the
    // uploader can takes an array of files it also returns an array of uris.
    // To get the uri we want we can call index [0] in the array.

    console.log("Uploading image...");
    const imageUri = await umi.uploader.upload([umiImageFile]).catch((err) => {
      throw new Error(err);
    });

    //
    // ** Upload Metadata to Arweave **
    //
    const Metadata = {
      image: imageUri[0],
      ...metadata,
      showName: true,
    };

    // Call upon umi's uploadJson function to upload our metadata to Arweave via Irys.
    console.log("Uploading metadata...");
    const metadataUri = await umi.uploader.uploadJson(Metadata).catch((err) => {
      throw new Error(err);
    });

    const finalMetadata: TokenMetadata = {
      name: metadata.name,
      symbol: metadata.symbol,
      mint: mint.publicKey,
      updateAuthority: payer.publicKey,
      uri: metadataUri,
      additionalMetadata: [["description", metadata.description]],
    };

    const mintAndPointerLen = getMintLen([
      ExtensionType.TransferFeeConfig,
      ExtensionType.MetadataPointer,
    ]); // Metadata extension is variable length, so we calculate it below
    const totalSpace = mintAndPointerLen;
    const metadataLen =
      pack(finalMetadata).length + TYPE_SIZE + LENGTH_SIZE + 100; // Buffer included
    const lamports = await connection.getMinimumBalanceForRentExemption(
      totalSpace + metadataLen
    );

    const initializeTransferFeeConfigInstruction =
      createInitializeTransferFeeConfigInstruction(
        mint.publicKey,
        new PublicKey(TAX_WALLET_ADDRESS),
        new PublicKey(TAX_WALLET_ADDRESS),
        txnFee * 100,
        BigInt(maxFee * 10 ** decimals),
        TOKEN_2022_PROGRAM_ID
      );

    const createMintAccountInstructions = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      lamports,
      newAccountPubkey: mint.publicKey,
      programId: TOKEN_2022_PROGRAM_ID,
      space: totalSpace,
    });

    const initMetadataPointerInstructions =
      createInitializeMetadataPointerInstruction(
        mint.publicKey,
        payer.publicKey,
        mint.publicKey, // we will point to the mint it self as the metadata account
        TOKEN_2022_PROGRAM_ID
      );

    const initMintInstructions = createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      payer.publicKey,
      freezeDisabled ? null : payer.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const initMetadataInstruction = createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint.publicKey,
      metadata: mint.publicKey,
      name: finalMetadata.name,
      symbol: finalMetadata.symbol,
      uri: finalMetadata.uri,
      mintAuthority: payer.publicKey,
      updateAuthority: payer.publicKey,
    });

    const updateMetadataFieldInstructions = createUpdateFieldInstruction({
      metadata: mint.publicKey,
      updateAuthority: payer.publicKey,
      programId: TOKEN_2022_PROGRAM_ID,
      field: finalMetadata.additionalMetadata[0][0],
      value: finalMetadata.additionalMetadata[0][1],
    });

    console.log("checking instructions");

    const transaction = new Transaction().add(
      createMintAccountInstructions,
      initializeTransferFeeConfigInstruction,
      initMetadataPointerInstructions,
      initMintInstructions,
      initMetadataInstruction,
      updateMetadataFieldInstructions // if you want to add any custom field
    );
    await sendAndConfirmTransaction(connection, transaction, [payer, mint]);

    console.log(
      `Check the token at https://explorer.solana.com/address/${mint.publicKey}`
    );

    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint.publicKey,
      payer.publicKey,
      false,
      "finalized",
      { commitment: "finalized" },
      TOKEN_2022_PROGRAM_ID
    );

    const mintTx = await mintToChecked(
      connection,
      payer,
      mint.publicKey,
      ata.address,
      payer.publicKey,
      mintTokens * 10 ** decimals,
      decimals,
      [payer],
      { commitment: "finalized" },
      TOKEN_2022_PROGRAM_ID
    );

    console.log(
      `Transaction for minting: https://explorer.solana.com/tx/${mintTx}`
    );

    if (mintDisabled) {
      const revokeMintAuthorityTx = await setAuthority(
        connection,
        payer,
        mint.publicKey,
        payer.publicKey,
        AuthorityType.MintTokens,
        null,
        [payer],
        { commitment: "finalized" },
        TOKEN_2022_PROGRAM_ID
      );

      console.log(
        `Transaction for revoking mint authority: https://explorer.solana.com/tx/${revokeMintAuthorityTx}`
      );
    }

    const tokenInfo = {
      address: mint.publicKey.toString(),
    };

    const tokenInfoPath = path.join(__dirname, "../../tokenInfo.json");
    fs.writeFileSync(tokenInfoPath, JSON.stringify(tokenInfo, null, 2));
  } catch (error) {
    console.error("Error creating token:", error);
  }
};
