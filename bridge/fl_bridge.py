"""Phiên bản Web3.py của cầu nối (dùng khi script AI chạy hoàn toàn bằng Python / trên RPi5).
    pip install web3
    python bridge/fl_bridge.py --round 1 --rpc http://127.0.0.1:8545 --network localhost --node-index 0 --key 0x...
Chỉ gửi submitUpdate cho MỘT node (chạy trên chính thiết bị đó) - hash tính từ file Δw nhị phân.
"""
import argparse, json, pathlib
from web3 import Web3

ROOT = pathlib.Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument("--round", type=int, required=True)
p.add_argument("--rpc", default="http://127.0.0.1:8545")
p.add_argument("--network", default="localhost")
p.add_argument("--node-index", type=int, required=True)
p.add_argument("--key", required=True)
a = p.parse_args()

w3 = Web3(Web3.HTTPProvider(a.rpc))
dep = json.loads((ROOT / "deployments" / f"{a.network}.json").read_text())
abi = json.loads((ROOT / "dashboard/src/contracts/FLManager.abi.json").read_text())
fl = w3.eth.contract(address=Web3.to_checksum_address(dep["contracts"]["FLManager"]), abi=abi)
acct = w3.eth.account.from_key(a.key)

d = ROOT / "ai_model" / "outputs" / f"round_{a.round}"
m = next(n for n in json.loads((d / "round.json").read_text())["nodes"] if n["nodeIndex"] == a.node_index)
delta_hash = Web3.keccak((d / m["weightsFile"]).read_bytes())

def send(fn):
    tx = fn.build_transaction({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address),
                               "chainId": w3.eth.chain_id})
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    return w3.eth.wait_for_transaction_receipt(h)

if not fl.functions.getNode(acct.address).call()[0]:
    send(fl.functions.registerNode(f"edge-node-{a.node_index + 1}"))
rc = send(fl.functions.submitUpdate(delta_hash, "", m["numSamples"], round(m["loss"] * 1e4), round(m["accuracy"] * 1e4)))
print("✔ submitUpdate tx =", rc.transactionHash.hex(), "hash =", delta_hash.hex())
