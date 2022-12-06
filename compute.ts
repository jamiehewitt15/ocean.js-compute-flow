import fs from 'fs'
import { homedir } from 'os'

import { SHA256 } from 'crypto-js'
import Web3 from 'web3'
import { AbiItem } from 'web3-utils'
import {
  ProviderInstance,
  Aquarius,
  NftFactory,
  Datatoken,
  Nft,
  ZERO_ADDRESS,
  transfer,
  sleep,
  approveWei,
  ProviderComputeInitialize,
  ConsumeMarketFee,
  ComputeAlgorithm,
  ComputeAsset,
  Config,
  Files,
  DDO,
  NftCreateData,
  DatatokenCreateParams,
  calculateEstimatedGas,
  sendTx,
  configHelperNetworks,
  ConfigHelper
} from '@oceanprotocol/lib'

const DATASET_ASSET_URL: Files = {
  datatokenAddress: '0x0',
  nftAddress: '0x0',
  files: [
    {
      type: 'url',
      url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
      method: 'GET'
    }
  ]
}

const ALGORITHM_ASSET_URL: Files = {
  datatokenAddress: '0x0',
  nftAddress: '0x0',
  files: [
    {
      type: 'url',
      url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
      method: 'GET'
    }
  ]
}
const DATASET_DDO: DDO = {
  '@context': ['https://w3id.org/did/v1'],
  id: 'id:op:efba17455c127a885ec7830d687a8f6e64f5ba559f8506f8723c1f10f05c049c',
  version: '4.1.0',
  chainId: 5,
  nftAddress: '0x0',
  metadata: {
    created: '2021-12-20T14:35:20Z',
    updated: '2021-12-20T14:35:20Z',
    type: 'dataset',
    name: 'dataset-name',
    description: 'Ocean protocol test dataset description',
    author: 'oceanprotocol-team',
    license: 'https://market.oceanprotocol.com/terms',
    additionalInformation: {
      termsAndConditions: true
    }
  },
  services: [
    {
      id: 'notAnId',
      type: 'compute',
      files: '',
      datatokenAddress: '0xa15024b732A8f2146423D14209eFd074e61964F3',
      serviceEndpoint: 'https://v4.provider.goerli.oceanprotocol.com/',
      timeout: 300,
      compute: {
        publisherTrustedAlgorithmPublishers: [],
        publisherTrustedAlgorithms: [],
        allowRawAlgorithm: true,
        allowNetworkAccess: true
      }
    }
  ]
}

const ALGORITHM_DDO: DDO = {
  '@context': ['https://w3id.org/did/v1'],
  id: 'did:op:efba17455c127a885ec7830d687a8f6e64f5ba559f8506f8723c1f10f05c049c',
  version: '4.1.0',
  chainId: 5,
  nftAddress: '0x0',
  metadata: {
    created: '2021-12-20T14:35:20Z',
    updated: '2021-12-20T14:35:20Z',
    type: 'algorithm',
    name: 'algorithm-name',
    description: 'Ocean protocol test algorithm description',
    author: 'oceanprotocol-team',
    license: 'https://market.oceanprotocol.com/terms',
    additionalInformation: {
      termsAndConditions: true
    },
    algorithm: {
      language: 'Node.js',
      version: '1.0.0',
      container: {
        entrypoint: 'node $ALGO',
        image: 'ubuntu',
        tag: 'latest',
        checksum:
          'sha256:2d7ecc9c5e08953d586a6e50c29b91479a48f69ac1ba1f9dc0420d18a728dfc5'
      }
    }
  },
  services: [
    {
      id: 'notAnId',
      type: 'access',
      files: '',
      datatokenAddress: '0xa15024b732A8f2146423D14209eFd074e61964F3',
      serviceEndpoint: 'https://v4.provider.goerli.oceanprotocol.com',
      timeout: 300
    }
  ]
}

let web3: Web3
let config: Config
let aquarius: Aquarius
let datatoken: Datatoken
let providerUrl: string
let publisherAccount: string
let consumerAccount: string
let addresses
let computeEnvs

let datasetId: string
let algorithmId: string
let resolvedDatasetDdo: DDO
let resolvedAlgorithmDdo: DDO

let computeJobId: string

async function createAsset(
  name: string,
  symbol: string,
  owner: string,
  assetUrl: Files,
  ddo: DDO,
  providerUrl: string
) {
  const nft = new Nft(web3)
  const Factory = new NftFactory(addresses.ERC721Factory, web3)

  // Now we update the DDO and set the right did
  const chain = await web3.eth.getChainId()
  ddo.chainId = parseInt(chain.toString(10))
  const nftParamsAsset: NftCreateData = {
    name,
    symbol,
    templateIndex: 1,
    tokenURI: 'aaa',
    transferable: true,
    owner
  }
  const datatokenParams: DatatokenCreateParams = {
    templateIndex: 1,
    cap: '100000',
    feeAmount: '0',
    paymentCollector: ZERO_ADDRESS,
    feeToken: ZERO_ADDRESS,
    minter: owner,
    mpFeeAddress: ZERO_ADDRESS
  }
  // Now we can make the contract call createNftWithDatatoken
  const result = await Factory.createNftWithDatatoken(
    owner,
    nftParamsAsset,
    datatokenParams
  )

  const nftAddress = result.events.NFTCreated.returnValues[0]
  const datatokenAddressAsset = result.events.TokenCreated.returnValues[0]
  ddo.nftAddress = web3.utils.toChecksumAddress(nftAddress)

  // Next we encrypt the file or files using Ocean Provider. The provider is an off chain proxy built specifically for this task
  assetUrl.datatokenAddress = datatokenAddressAsset
  assetUrl.nftAddress = ddo.nftAddress
  let providerResponse = await ProviderInstance.encrypt(assetUrl, providerUrl)
  ddo.services[0].files = await providerResponse
  ddo.services[0].datatokenAddress = datatokenAddressAsset
  ddo.services[0].serviceEndpoint = providerUrl

  // Next we update ddo and set the right did
  ddo.nftAddress = web3.utils.toChecksumAddress(nftAddress)
  ddo.id =
    'did:op:' + SHA256(web3.utils.toChecksumAddress(nftAddress) + chain.toString(10))
  providerResponse = await ProviderInstance.encrypt(ddo, providerUrl)
  const encryptedResponse = await providerResponse
  const validateResult = await aquarius.validate(ddo)

  // Next you can check if if the ddo is valid by checking if validateResult.valid returned true

  await nft.setMetadata(
    nftAddress,
    owner,
    0,
    providerUrl,
    '',
    '0x2',
    encryptedResponse,
    validateResult.hash
  )
  return ddo.id
}

async function handleOrder(
  order: ProviderComputeInitialize,
  datatokenAddress: string,
  payerAccount: string,
  consumerAccount: string,
  serviceIndex: number,
  consumeMarkerFee?: ConsumeMarketFee
) {
  /* We do have 3 possible situations:
       - have validOrder and no providerFees -> then order is valid, providerFees are valid, just use it in startCompute
       - have validOrder and providerFees -> then order is valid but providerFees are not valid, we need to call reuseOrder and pay only providerFees
       - no validOrder -> we need to call startOrder, to pay 1 DT & providerFees
    */
  if (order.providerFee && order.providerFee.providerFeeAmount) {
    await approveWei(
      web3,
      config,
      payerAccount,
      order.providerFee.providerFeeToken,
      datatokenAddress,
      order.providerFee.providerFeeAmount
    )
  }
  if (order.validOrder) {
    if (!order.providerFee) return order.validOrder
    const tx = await datatoken.reuseOrder(
      datatokenAddress,
      payerAccount,
      order.validOrder,
      order.providerFee
    )
    return tx.transactionHash
  }
  const tx = await datatoken.startOrder(
    datatokenAddress,
    payerAccount,
    consumerAccount,
    serviceIndex,
    order.providerFee,
    consumeMarkerFee
  )
  return tx.transactionHash
}

async function run() {
  web3 = new Web3(process.env.NODE_URI || configHelperNetworks[1].nodeUri)
  config = new ConfigHelper().getConfig(await web3.eth.getChainId())
  config.providerUri = process.env.PROVIDER_URL || config.providerUri
  addresses = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.readFileSync(
      process.env.ADDRESS_FILE ||
        `${homedir}/.ocean/ocean-contracts/artifacts/address.json`,
      'utf8'
    )
  ).development
  aquarius = new Aquarius(config.metadataCacheUri)
  providerUrl = config.providerUri
  datatoken = new Datatoken(web3)

  console.log(`Aquarius URL: ${config.metadataCacheUri}`)
  console.log(`Provider URL: ${providerUrl}`)
  console.log(`Deployed contracts address: ${addresses}`)

  const accounts = await web3.eth.getAccounts()
  publisherAccount = accounts[0]
  consumerAccount = accounts[1]

  console.log(`Publisher account address: ${publisherAccount}`)
  console.log(`Consumer account address: ${consumerAccount}`)

  const minAbi = [
    {
      constant: false,
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }
      ],
      name: 'mint',
      outputs: [{ name: '', type: 'bool' }],
      payable: false,
      stateMutability: 'nonpayable',
      type: 'function'
    }
  ] as AbiItem[]
  const tokenContract = new web3.eth.Contract(minAbi, addresses.Ocean)
  const estGas = await calculateEstimatedGas(
    publisherAccount,
    tokenContract.methods.mint,
    publisherAccount,
    web3.utils.toWei('1000')
  )
  await sendTx(
    publisherAccount,
    estGas,
    web3,
    1,
    tokenContract.methods.mint,
    publisherAccount,
    web3.utils.toWei('1000')
  )

  transfer(web3, config, publisherAccount, addresses.Ocean, consumerAccount, '100')

  datasetId = await createAsset(
    'D1Min',
    'D1M',
    publisherAccount,
    DATASET_ASSET_URL,
    DATASET_DDO,
    providerUrl
  )

  console.log(`dataset id: ${datasetId}`)

  algorithmId = await createAsset(
    'D1Min',
    'D1M',
    publisherAccount,
    ALGORITHM_ASSET_URL,
    ALGORITHM_DDO,
    providerUrl
  )
  console.log(`algorithm id: ${algorithmId}`)

  resolvedDatasetDdo = await aquarius.waitForAqua(datasetId)
  resolvedAlgorithmDdo = await aquarius.waitForAqua(algorithmId)

  await datatoken.mint(
    resolvedDatasetDdo.services[0].datatokenAddress,
    publisherAccount,
    '10',
    consumerAccount
  )

  await datatoken.mint(
    resolvedAlgorithmDdo.services[0].datatokenAddress,
    publisherAccount,
    '10',
    consumerAccount
  )

  computeEnvs = await ProviderInstance.getComputeEnvironments(providerUrl)

  const computeEnv = computeEnvs.find((ce) => ce.priceMin === 0)
  console.log('Free compute environment = ', computeEnv)

  const mytime = new Date()
  const computeMinutes = 5
  mytime.setMinutes(mytime.getMinutes() + computeMinutes)
  const computeValidUntil = Math.floor(mytime.getTime() / 1000)

  const assets: ComputeAsset[] = [
    {
      documentId: resolvedDatasetDdo.id,
      serviceId: resolvedDatasetDdo.services[0].id
    }
  ]
  const dtAddressArray = [resolvedDatasetDdo.services[0].datatokenAddress]
  const algo: ComputeAlgorithm = {
    documentId: resolvedAlgorithmDdo.id,
    serviceId: resolvedAlgorithmDdo.services[0].id
  }

  const providerInitializeComputeResults = await ProviderInstance.initializeCompute(
    assets,
    algo,
    computeEnv.id,
    computeValidUntil,
    providerUrl,
    consumerAccount
  )

  algo.transferTxId = await handleOrder(
    providerInitializeComputeResults.algorithm,
    resolvedAlgorithmDdo.services[0].datatokenAddress,
    consumerAccount,
    computeEnv.consumerAddress,
    0
  )
  for (let i = 0; i < providerInitializeComputeResults.datasets.length; i++) {
    assets[i].transferTxId = await handleOrder(
      providerInitializeComputeResults.datasets[i],
      dtAddressArray[i],
      consumerAccount,
      computeEnv.consumerAddress,
      0
    )
  }
  const computeJobs = await ProviderInstance.computeStart(
    providerUrl,
    web3,
    consumerAccount,
    computeEnv.id,
    assets[0],
    algo
  )

  computeJobId = computeJobs[0].jobId

  const jobStatus = await ProviderInstance.computeStatus(
    providerUrl,
    consumerAccount,
    computeJobId,
    DATASET_DDO.id
  )

  console.log('Current status of the compute job: ', jobStatus)

  await sleep(10000)
  const downloadURL = await ProviderInstance.getComputeResultUrl(
    providerUrl,
    web3,
    consumerAccount,
    computeJobId,
    0
  )

  console.log(`Compute results URL: ${downloadURL}`)
}

run()
