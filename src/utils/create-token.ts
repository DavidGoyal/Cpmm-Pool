import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import {
  createGenericFile,
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  createAssociatedTokenAccountInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  LENGTH_SIZE,
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
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import {
  decimals,
  JITO_TIP_SOL,
  maxFee,
  metadata,
  mintTokens,
  PRIVATE_KEY,
  RPC_URL,
  TAX_WALLET_ADDRESS,
  txnFee,
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
          address: "https://node1.irys.xyz",
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
      additionalMetadata: [["Description", metadata.description]],
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

    let encodedSignedTxns = [];
    let signatures = [];

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
      null,
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
      updateMetadataFieldInstructions
    );

    let blockhash = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash.blockhash;
    transaction.feePayer = payer.publicKey;
    transaction.sign(payer, mint);
    const serializedCreateTokenTx = transaction.serialize();
    let encodedCreateTokenTx = bs58.encode(serializedCreateTokenTx);
    encodedSignedTxns.push(encodedCreateTokenTx);
    signatures.push(bs58.encode(transaction.signature!));

    const ata = getAssociatedTokenAddressSync(
      mint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const createAtaTxn = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        payer.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    blockhash = await connection.getLatestBlockhash();
    createAtaTxn.recentBlockhash = blockhash.blockhash;
    createAtaTxn.feePayer = payer.publicKey;
    createAtaTxn.sign(payer);

    const serializedCreateAtaTxn = createAtaTxn.serialize();
    let encodedCreateAtaTxn = bs58.encode(serializedCreateAtaTxn);
    encodedSignedTxns.push(encodedCreateAtaTxn);
    signatures.push(bs58.encode(createAtaTxn.signature!));

    const mintTx = new Transaction().add(
      createMintToCheckedInstruction(
        mint.publicKey,
        payer.publicKey,
        payer.publicKey,
        mintTokens * 10 ** decimals,
        decimals,
        [payer],
        TOKEN_2022_PROGRAM_ID
      )
    );
    blockhash = await connection.getLatestBlockhash();
    mintTx.recentBlockhash = blockhash.blockhash;
    mintTx.feePayer = payer.publicKey;
    mintTx.sign(payer);

    const serializedMintTxn = mintTx.serialize();
    let encodedMintTxn = bs58.encode(serializedMintTxn);
    encodedSignedTxns.push(encodedMintTxn);
    signatures.push(bs58.encode(mintTx.signature!));

    const revokeTxn = new Transaction().add(
      createSetAuthorityInstruction(
        mint.publicKey,
        payer.publicKey,
        AuthorityType.MintTokens,
        null,
        [payer],
        TOKEN_2022_PROGRAM_ID
      )
    );

    blockhash = await connection.getLatestBlockhash();
    revokeTxn.recentBlockhash = blockhash.blockhash;
    revokeTxn.feePayer = payer.publicKey;
    revokeTxn.sign(payer);

    const serializedRevokeTxn = revokeTxn.serialize();
    let encodedRevokeTxn = bs58.encode(serializedRevokeTxn);
    encodedSignedTxns.push(encodedRevokeTxn);
    signatures.push(bs58.encode(revokeTxn.signature!));

    const jitoTipTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey("96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"),
        lamports: JITO_TIP_SOL * LAMPORTS_PER_SOL,
      })
    );
    blockhash = await connection.getLatestBlockhash();
    jitoTipTx.recentBlockhash = blockhash.blockhash;
    jitoTipTx.feePayer = payer.publicKey;
    jitoTipTx.sign(payer);

    const serializedJitoTipTxn = jitoTipTx.serialize();
    let encodedJitoTipTxn = bs58.encode(serializedJitoTipTxn);
    encodedSignedTxns.push(encodedJitoTipTxn);
    signatures.push(bs58.encode(jitoTipTx.signature!));

    try {
      const jitoResponse = await fetch(
        `https://mainnet.block-engine.jito.wtf/api/v1/bundles`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [encodedSignedTxns],
          }),
        }
      );
      if (!jitoResponse.ok) {
        const errorText = await jitoResponse.text();
        throw new Error(`Jito bundle failed: ${errorText}`);
      }
      const jitoResult = await jitoResponse.json();
    } catch (e) {
      throw new Error(`Error sending bundle: ${e}`);
    }

    for (let i = 0; i < signatures.length; i++) {
      const latestBlockHash = await connection.getLatestBlockhash();
      console.log(
        `Waiting for transaction at ${signatures[i]} to get confirmed`
      );
      await connection.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: signatures[0],
      });
    }

    console.log(
      `Check the token at https://explorer.solana.com/address/${mint.publicKey}`
    );

    const tokenInfo = {
      address: mint.publicKey.toString(),
    };

    const tokenInfoPath = path.join(__dirname, "../../tokenInfo.json");
    fs.writeFileSync(tokenInfoPath, JSON.stringify(tokenInfo, null, 2));
  } catch (error) {
    console.error("Error creating token:", error);
  }
};
