import { jest } from '@jest/globals'
import { CID } from 'multiformats/cid'
import { decode as decodeMultiHash } from 'multiformats/hashes/digest'
import * as dagCBOR from '@ipld/dag-cbor'
import type { DID } from 'dids'
import { wrapDocument } from '@ceramicnetwork/3id-did-resolver'
import * as KeyDidResolver from 'key-did-resolver'
import { ModelInstanceDocumentHandler } from '../model-instance-document-handler.js'
import * as uint8arrays from 'uint8arrays'
import * as sha256 from '@stablelib/sha256'
import cloneDeep from 'lodash.clonedeep'
import jsonpatch from 'fast-json-patch'
import { ModelInstanceDocument } from '@ceramicnetwork/stream-model-instance'
import {
  CeramicApi,
  CommitType,
  Context,
  StreamUtils,
  SignedCommitContainer,
  TestUtils,
  IpfsApi,
  CeramicSigner,
} from '@ceramicnetwork/common'
import { parse as parseDidUrl } from 'did-resolver'
import { StreamID } from '@ceramicnetwork/streamid'
import { DummySchemaValidation } from '../schema-utils.js'

jest.unstable_mockModule('did-jwt', () => {
  return {
    // TODO - We should test for when this function throws as well
    // Mock: Blindly accept a signature
    verifyJWS: (): void => {
      return
    },
    // And these functions are required for the test to run ¯\_(ツ)_/¯
    resolveX25519Encrypters: () => {
      return []
    },
    createJWE: () => {
      return {}
    },
  }
})

const hash = (data: string): CID => {
  const body = uint8arrays.concat([
    uint8arrays.fromString('1220', 'base16'),
    sha256.hash(uint8arrays.fromString(data)),
  ])
  return CID.create(1, 0x12, decodeMultiHash(body))
}

const FAKE_CID_1 = CID.parse('bafybeig6xv5nwphfmvcnektpnojts33jqcuam7bmye2pb54adnrtccjlsu')
const FAKE_CID_2 = CID.parse('bafybeig6xv5nwphfmvcnektpnojts44jqcuam7bmye2pb54adnrtccjlsu')
const FAKE_CID_3 = CID.parse('bafybeig6xv5nwphfmvcnektpnojts55jqcuam7bmye2pb54adnrtccjlsu')
const FAKE_CID_4 = CID.parse('bafybeig6xv5nwphfmvcnektpnojts66jqcuam7bmye2pb54adnrtccjlsu')
const DID_ID = 'did:3:k2t6wyfsu4pg0t2n4j8ms3s33xsgqjhtto04mvq8w5a2v5xo48idyz38l7ydki'
const FAKE_STREAM_ID = StreamID.fromString(
  'kjzl6cwe1jw147dvq16zluojmraqvwdmbh61dx9e0c59i344lcrsgqfohexp60s'
)

const CONTENT0 = { myData: 0 }
const CONTENT1 = { myData: 1 }
const CONTENT2 = { myData: 2 }
const METADATA = { controller: DID_ID, model: FAKE_STREAM_ID }

const jwsForVersion0 = {
  payload: 'bbbb',
  signatures: [
    {
      protected:
        'eyJraWQiOiJkaWQ6MzprMnQ2d3lmc3U0cGcwdDJuNGo4bXMzczMzeHNncWpodHRvMDRtdnE4dzVhMnY1eG80OGlkeXozOGw3eWRraT92ZXJzaW9uPTAjc2lnbmluZyIsImFsZyI6IkVTMjU2SyJ9',
      signature: 'cccc',
    },
  ],
}

const jwsForVersion1 = {
  payload: 'bbbb',
  signatures: [
    {
      protected:
        'ewogICAgImtpZCI6ImRpZDozOmsydDZ3eWZzdTRwZzB0Mm40ajhtczNzMzN4c2dxamh0dG8wNG12cTh3NWEydjV4bzQ4aWR5ejM4bDd5ZGtpP3ZlcnNpb249MSNzaWduaW5nIgp9',
      signature: 'cccc',
    },
  ],
}

const ThreeIdResolver = {
  '3': async (did) => ({
    didResolutionMetadata: { contentType: 'application/did+json' },
    didDocument: wrapDocument(
      {
        publicKeys: {
          signing: 'zQ3shwsCgFanBax6UiaLu1oGvM7vhuqoW88VBUiUTCeHbTeTV',
          encryption: 'z6LSfQabSbJzX8WAm1qdQcHCHTzVv8a2u6F7kmzdodfvUCo9',
        },
      },
      did
    ),
    didDocumentMetadata: {},
  }),
}

const setDidToNotRotatedState = (did: DID) => {
  const keyDidResolver = KeyDidResolver.getResolver()
  did.setResolver({
    ...keyDidResolver,
    ...ThreeIdResolver,
  })

  did.createJWS = async () => jwsForVersion0
}

// TODO: De-dupe this with similar code from tile-document-handler.test.ts and model.test.ts
const rotateKey = (did: DID, rotateDate: string) => {
  did.resolve = async (didUrl) => {
    const { did } = parseDidUrl(didUrl)
    const isVersion0 = /version=0/.exec(didUrl)

    if (isVersion0) {
      return {
        didResolutionMetadata: { contentType: 'application/did+json' },
        didDocument: wrapDocument(
          {
            publicKeys: {
              signing: 'zQ3shwsCgFanBax6UiaLu1oGvM7vhuqoW88VBUiUTCeHbTeTV',
              encryption: 'z6LSfQabSbJzX8WAm1qdQcHCHTzVv8a2u6F7kmzdodfvUCo9',
            },
          },
          did
        ),
        didDocumentMetadata: {
          nextUpdate: rotateDate,
        },
      }
    }

    return {
      didResolutionMetadata: { contentType: 'application/did+json' },
      didDocument: wrapDocument(
        {
          publicKeys: {
            signing: 'zQ3shwsCgFanBax6UiaLu1oGvM7vhuqoW88VBUiUTCeHbTeTV',
            encryption: 'z6MkjKeH8SgVAYCvTBoyxx7uRJFGM2a9HUeFwfJfd6ctuA3X',
          },
        },
        did
      ),
      didDocumentMetadata: {
        updated: rotateDate,
      },
    }
  }

  did.createJWS = async () => jwsForVersion1
}

async function checkSignedCommitMatchesExpectations(
  did: DID,
  commit: SignedCommitContainer,
  expectedCommit: Record<string, any>
) {
  const { jws, linkedBlock } = commit
  expect(jws).toBeDefined()
  expect(linkedBlock).toBeDefined()

  const payload = dagCBOR.decode(linkedBlock)

  const unpacked = { jws, linkedBlock: payload }

  // Add the 'unique' header field to the data used to generate the expected genesis commit
  if (unpacked.linkedBlock.header?.unique) {
    expectedCommit.header['unique'] = unpacked.linkedBlock.header.unique
  }

  const expected = await did.createDagJWS(expectedCommit)
  expect(expected).toBeDefined()

  const { jws: eJws, linkedBlock: eLinkedBlock } = expected
  const ePayload = dagCBOR.decode(eLinkedBlock)
  const signed = { jws: eJws, linkedBlock: ePayload }

  expect(unpacked).toEqual(signed)
}

describe('ModelInstanceDocumentHandler with dummy schema validator', () => {
  let did: DID
  let handler: ModelInstanceDocumentHandler
  let context: Context
  let signerUsingNewKey: CeramicSigner
  let signerUsingOldKey: CeramicSigner

  beforeAll(async () => {
    const recs: Record<string, any> = {}
    const ipfs = {
      dag: {
        put(rec: any, cid?: CID): any {
          if (cid) {
            recs[cid.toString()] = { value: rec }
            return cid
          }
          // stringify as a way of doing deep copy
          const clone = cloneDeep(rec)
          const c = hash(JSON.stringify(clone))
          recs[c.toString()] = { value: clone }
          return c
        },
        get(cid: any): any {
          return recs[cid.toString()]
        },
      },
    } as IpfsApi

    const keyDidResolver = KeyDidResolver.getResolver()
    const { DID } = await import('dids')
    did = new DID({
      resolver: {
        ...keyDidResolver,
      },
    })
    ;(did as any)._id = DID_ID
    const api = {
      getSupportedChains: jest.fn(async () => {
        return ['fakechain:123']
      }),
      did,
    }

    signerUsingNewKey = { did: new DID({}) }
    ;(signerUsingNewKey.did as any)._id = DID_ID
    signerUsingNewKey.did.createJWS = async () => jwsForVersion1

    signerUsingOldKey = { did: new DID({}) }
    ;(signerUsingOldKey.did as any)._id = DID_ID
    signerUsingOldKey.did.createJWS = async () => jwsForVersion0

    context = {
      did,
      ipfs,
      anchorService: null,
      api: api as unknown as CeramicApi,
    }
  })

  beforeEach(() => {
    handler = new ModelInstanceDocumentHandler({
      schemaValidator: new DummySchemaValidation()
    })

    setDidToNotRotatedState(did)
  })

  it('is constructed correctly', async () => {
    expect(handler.name).toEqual('MID')
  })

  it('makes genesis commits correctly', async () => {
    const commit = await ModelInstanceDocument._makeGenesis(context.api, CONTENT0, METADATA)
    expect(commit).toBeDefined()

    const expectedGenesis = {
      data: CONTENT0,
      header: { controllers: [METADATA.controller], model: METADATA.model.bytes },
    }

    await checkSignedCommitMatchesExpectations(did, commit, expectedGenesis)
  })

  it('null content in genesis is valid', async () => {
    const commit = await ModelInstanceDocument._makeGenesis(context.api, null, METADATA)
    expect(commit).toBeDefined()

    const expectedGenesis = {
      data: null,
      header: { controllers: [METADATA.controller], model: METADATA.model.bytes },
    }

    await checkSignedCommitMatchesExpectations(did, commit, expectedGenesis)
  })

  it('Takes controller from authenticated DID if controller not specified', async () => {
    const commit = await ModelInstanceDocument._makeGenesis(context.api, null, {
      model: FAKE_STREAM_ID,
    })
    expect(commit).toBeDefined()

    const expectedGenesis = {
      data: null,
      header: { controllers: [METADATA.controller], model: METADATA.model.bytes },
    }

    await checkSignedCommitMatchesExpectations(did, commit, expectedGenesis)
  })

  it('model is required', async () => {
    await expect(ModelInstanceDocument._makeGenesis(context.api, null, {})).rejects.toThrow(
      /Must specify a 'model' when creating a ModelInstanceDocument/
    )
  })

  it('creates genesis commits uniquely', async () => {
    const commit1 = await ModelInstanceDocument._makeGenesis(context.api, CONTENT0, METADATA)
    const commit2 = await ModelInstanceDocument._makeGenesis(context.api, CONTENT0, METADATA)

    expect(commit1).not.toEqual(commit2)
  })

  it('applies genesis commit correctly', async () => {
    const commit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      CONTENT0,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(commit, FAKE_CID_1)

    const payload = dagCBOR.decode(commit.linkedBlock)
    await context.ipfs.dag.put(payload, commit.jws.link)

    const commitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: commit.jws,
    }
    const streamState = await handler.applyCommit(commitData, context)
    delete streamState.metadata.unique
    expect(streamState).toMatchSnapshot()
  })

  it('makes signed commit correctly', async () => {
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      CONTENT0,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
    }
    const state = await handler.applyCommit(genesisCommitData, context)
    const state$ = TestUtils.runningState(state)
    const doc = new ModelInstanceDocument(state$, context)

    await expect(doc._makeCommit({} as CeramicApi, CONTENT1)).rejects.toThrow(/No DID/)

    const commit = (await doc._makeCommit(context.api, CONTENT1)) as SignedCommitContainer
    const patch = jsonpatch.compare(CONTENT0, CONTENT1)
    const expectedCommit = { data: patch, prev: FAKE_CID_1, id: FAKE_CID_1 }
    await checkSignedCommitMatchesExpectations(did, commit, expectedCommit)
  })

  it('applies signed commit correctly', async () => {
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      CONTENT0,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // apply genesis
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
    }
    let state = await handler.applyCommit(genesisCommitData, context)

    const state$ = TestUtils.runningState(state)
    const doc = new ModelInstanceDocument(state$, context)
    const signedCommit = (await doc._makeCommit(context.api, CONTENT1)) as SignedCommitContainer

    await context.ipfs.dag.put(signedCommit, FAKE_CID_2)

    const sPayload = dagCBOR.decode(signedCommit.linkedBlock)
    await context.ipfs.dag.put(sPayload, signedCommit.jws.link)

    // apply signed
    const signedCommitData = {
      cid: FAKE_CID_2,
      type: CommitType.SIGNED,
      commit: sPayload,
      envelope: signedCommit.jws,
    }
    state = await handler.applyCommit(signedCommitData, context, state)
    delete state.metadata.unique
    delete state.next.metadata.unique
    expect(state).toMatchSnapshot()
  })

  it('multiple consecutive updates', async () => {
    const deepCopy = (o) => StreamUtils.deserializeState(StreamUtils.serializeState(o))

    const genesisCommit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      CONTENT0,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)
    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)
    // apply genesis
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
    }
    const genesisState = await handler.applyCommit(genesisCommitData, context)

    // make a first update
    const state$ = TestUtils.runningState(genesisState)
    let doc = new ModelInstanceDocument(state$, context)
    const signedCommit1 = (await doc._makeCommit(context.api, CONTENT1)) as SignedCommitContainer

    await context.ipfs.dag.put(signedCommit1, FAKE_CID_2)
    const sPayload1 = dagCBOR.decode(signedCommit1.linkedBlock)
    await context.ipfs.dag.put(sPayload1, signedCommit1.jws.link)
    // apply signed
    const signedCommitData_1 = {
      cid: FAKE_CID_2,
      type: CommitType.SIGNED,
      commit: sPayload1,
      envelope: signedCommit1.jws,
    }
    const state1 = await handler.applyCommit(signedCommitData_1, context, deepCopy(genesisState))

    // make a second update on top of the first
    const state1$ = TestUtils.runningState(state1)
    doc = new ModelInstanceDocument(state1$, context)
    const signedCommit2 = (await doc._makeCommit(context.api, CONTENT2)) as SignedCommitContainer

    await context.ipfs.dag.put(signedCommit2, FAKE_CID_3)
    const sPayload2 = dagCBOR.decode(signedCommit2.linkedBlock)
    await context.ipfs.dag.put(sPayload2, signedCommit2.jws.link)

    // apply signed
    const signedCommitData_2 = {
      cid: FAKE_CID_3,
      type: CommitType.SIGNED,
      commit: sPayload2,
      envelope: signedCommit2.jws,
    }
    const state2 = await handler.applyCommit(signedCommitData_2, context, deepCopy(state1))
    delete state2.metadata.unique
    delete state2.next.metadata.unique
    expect(state2).toMatchSnapshot()
  })

  it('Can update null genesis content to real content', async () => {
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      null,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // apply genesis
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
    }
    let state = await handler.applyCommit(genesisCommitData, context)

    const state$ = TestUtils.runningState(state)
    const doc = new ModelInstanceDocument(state$, context)
    const signedCommit = (await doc._makeCommit(context.api, CONTENT1)) as SignedCommitContainer

    await context.ipfs.dag.put(signedCommit, FAKE_CID_2)

    const sPayload = dagCBOR.decode(signedCommit.linkedBlock)
    await context.ipfs.dag.put(sPayload, signedCommit.jws.link)

    // apply signed
    const signedCommitData = {
      cid: FAKE_CID_2,
      type: CommitType.SIGNED,
      commit: sPayload,
      envelope: signedCommit.jws,
    }
    state = await handler.applyCommit(signedCommitData, context, state)
    delete state.metadata.unique
    delete state.next.metadata.unique
    expect(state).toMatchSnapshot()
  })

  it('Can set existing content to null', async () => {
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      CONTENT0,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // apply genesis
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
    }
    let state = await handler.applyCommit(genesisCommitData, context)

    const state$ = TestUtils.runningState(state)
    const doc = new ModelInstanceDocument(state$, context)
    const signedCommit = (await doc._makeCommit(context.api, null)) as SignedCommitContainer

    await context.ipfs.dag.put(signedCommit, FAKE_CID_2)

    const sPayload = dagCBOR.decode(signedCommit.linkedBlock)
    await context.ipfs.dag.put(sPayload, signedCommit.jws.link)

    // apply signed
    const signedCommitData = {
      cid: FAKE_CID_2,
      type: CommitType.SIGNED,
      commit: sPayload,
      envelope: signedCommit.jws,
    }
    state = await handler.applyCommit(signedCommitData, context, state)
    delete state.metadata.unique
    delete state.next.metadata.unique
    expect(state).toMatchSnapshot()
  })

  it('throws error if commit signed by wrong DID', async () => {
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(context.api, CONTENT0, {
      controller: 'did:3:fake',
      model: FAKE_STREAM_ID,
    })) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
      timestamp: Date.now(),
    }
    await expect(handler.applyCommit(genesisCommitData, context)).rejects.toThrow(
      /invalid_jws: not a valid verificationMethod for issuer/
    )
  })

  it('throws error if changes metadata', async () => {
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      CONTENT0,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // apply genesis
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
    }
    const state = await handler.applyCommit(genesisCommitData, context)

    const state$ = TestUtils.runningState(state)
    const doc = new ModelInstanceDocument(state$, context)
    const rawCommit = doc._makeRawCommit(CONTENT1)
    rawCommit.header = { controllers: [did.id, did.id] }
    const signedCommit = await ModelInstanceDocument._signDagJWS(context.api, rawCommit)

    await context.ipfs.dag.put(signedCommit, FAKE_CID_2)

    const sPayload = dagCBOR.decode(signedCommit.linkedBlock)
    await context.ipfs.dag.put(sPayload, signedCommit.jws.link)

    // apply signed
    const signedCommitData = {
      cid: FAKE_CID_2,
      type: CommitType.SIGNED,
      commit: sPayload,
      envelope: signedCommit.jws,
    }
    await expect(handler.applyCommit(signedCommitData, context, state)).rejects.toThrow(
      /Updating metadata for ModelInstanceDocument Streams is not allowed/
    )
  })

  it('applies anchor commit correctly', async () => {
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(
      context.api,
      CONTENT0,
      METADATA
    )) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // apply genesis
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
    }
    let state = await handler.applyCommit(genesisCommitData, context)

    const state$ = TestUtils.runningState(state)
    const doc = new ModelInstanceDocument(state$, context)
    const signedCommit = (await doc._makeCommit(context.api, CONTENT1)) as SignedCommitContainer

    await context.ipfs.dag.put(signedCommit, FAKE_CID_2)

    const sPayload = dagCBOR.decode(signedCommit.linkedBlock)
    await context.ipfs.dag.put(sPayload, signedCommit.jws.link)

    // apply signed
    const signedCommitData = {
      cid: FAKE_CID_2,
      type: CommitType.SIGNED,
      commit: sPayload,
      envelope: signedCommit.jws,
    }
    state = await handler.applyCommit(signedCommitData, context, state)

    // apply anchor
    const anchorProof = {
      blockNumber: 123456,
      blockTimestamp: 1615799679,
      chainId: 'fakechain:123',
    }
    await context.ipfs.dag.put(anchorProof, FAKE_CID_3)
    const anchorCommitData = {
      cid: FAKE_CID_4,
      type: CommitType.ANCHOR,
      commit: { proof: FAKE_CID_3, prev: FAKE_CID_2 },
      proof: anchorProof,
    }
    state = await handler.applyCommit(anchorCommitData, context, state)
    delete state.metadata.unique
    expect(state).toMatchSnapshot()
  })

  it('fails to apply commit if old key is used to make the commit and keys have been rotated', async () => {
    const rotateDate = new Date('2022-03-11T21:28:07.383Z')

    // make and apply genesis with old key
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(signerUsingOldKey, CONTENT0, {
      model: FAKE_STREAM_ID,
    })) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // genesis commit applied one hour before rotation
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
      timestamp: rotateDate.valueOf() / 1000 - 60 * 60,
    }

    const state = await handler.applyCommit(genesisCommitData, context)

    rotateKey(did, rotateDate.toISOString())

    // make update with old key
    const state$ = TestUtils.runningState(state)
    const doc = new ModelInstanceDocument(state$, context)
    const signedCommit = (await doc._makeCommit(
      signerUsingOldKey,
      CONTENT1
    )) as SignedCommitContainer

    await context.ipfs.dag.put(signedCommit, FAKE_CID_2)

    const sPayload = dagCBOR.decode(signedCommit.linkedBlock)
    await context.ipfs.dag.put(sPayload, signedCommit.jws.link)

    const signedCommitData = {
      cid: FAKE_CID_2,
      type: CommitType.SIGNED,
      commit: sPayload,
      envelope: signedCommit.jws,
      // 24 hours after rotation
      timestamp: rotateDate.valueOf() / 1000 + 24 * 60 * 60,
    }

    // applying a commit made with the old key after rotation
    await expect(handler.applyCommit(signedCommitData, context, state)).rejects.toThrow(
      /invalid_jws: signature authored with a revoked DID version/
    )
  })

  it('fails to apply commit if new key used before rotation', async () => {
    const rotateDate = new Date('2022-03-11T21:28:07.383Z')

    // make genesis with new key
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(signerUsingNewKey, CONTENT0, {
      model: FAKE_STREAM_ID,
    })) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // commit is applied 1 hour before rotation
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
      timestamp: rotateDate.valueOf() / 1000 - 60 * 60,
    }

    rotateKey(did, rotateDate.toISOString())

    await expect(handler.applyCommit(genesisCommitData, context)).rejects.toThrow(
      /invalid_jws: signature authored before creation of DID version/
    )
  })

  it('applies commit made using an old key if it is applied within the revocation period', async () => {
    const rotateDate = new Date('2022-03-11T21:28:07.383Z')
    rotateKey(did, rotateDate.toISOString())

    // make genesis commit using old key
    const genesisCommit = (await ModelInstanceDocument._makeGenesis(signerUsingOldKey, CONTENT0, {
      model: FAKE_STREAM_ID,
    })) as SignedCommitContainer
    await context.ipfs.dag.put(genesisCommit, FAKE_CID_1)

    const payload = dagCBOR.decode(genesisCommit.linkedBlock)
    await context.ipfs.dag.put(payload, genesisCommit.jws.link)

    // commit is applied 1 hour after the rotation
    const genesisCommitData = {
      cid: FAKE_CID_1,
      type: CommitType.GENESIS,
      commit: payload,
      envelope: genesisCommit.jws,
      timestamp: rotateDate.valueOf() / 1000 + 60 * 60,
    }
    const state = await handler.applyCommit(genesisCommitData, context)
    delete state.metadata.unique

    expect(state).toMatchSnapshot()
  })
})
