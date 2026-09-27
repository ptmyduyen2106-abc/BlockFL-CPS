"""
fedavg.py — Federated Averaging (FedAvg) với N node giả lập
Sau mỗi round: tính hash(∆w) → gửi lên FLManager.sol qua Web3.py
"""

import argparse
import hashlib
import json
import pickle
import numpy as np
import tensorflow as tf
from model import build_model, compile_model
from data_pipeline import load_and_split

# ── Web3 (comment out nếu chưa deploy contract) ───────────────────────────
try:
    from web3 import Web3
    WEB3_ENABLED = True
except ImportError:
    WEB3_ENABLED = False
    print("[WARN] web3 chưa cài — bỏ qua gửi on-chain")


def get_weights_hash(weights: list) -> str:
    """Tính keccak256 của flatten weights (dùng hashlib sha3_256 thay thế)."""
    flat = np.concatenate([w.flatten() for w in weights])
    raw  = flat.astype(np.float32).tobytes()
    return "0x" + hashlib.sha3_256(raw).hexdigest()


def fedavg_aggregate(weight_list: list) -> list:
    """Tính trung bình trọng số từ N node."""
    avg = [np.zeros_like(w) for w in weight_list[0]]
    n   = len(weight_list)
    for weights in weight_list:
        for i, w in enumerate(weights):
            avg[i] += w / n
    return avg


def local_train(model: tf.keras.Model, X, y, epochs=3, batch_size=32):
    model.fit(X, y, epochs=epochs, batch_size=batch_size, verbose=0)
    return model.get_weights()


def submit_hash_onchain(weight_hash: str, contract_address: str,
                        abi_path: str, rpc_url: str, private_key: str):
    """Gửi hash(∆w) lên FLManager.sol."""
    if not WEB3_ENABLED:
        print(f"[SKIP] hash={weight_hash} (web3 disabled)")
        return

    w3       = Web3(Web3.HTTPProvider(rpc_url))
    with open(abi_path) as f:
        abi = json.load(f)["abi"]

    contract = w3.eth.contract(address=contract_address, abi=abi)
    account  = w3.eth.account.from_key(private_key)

    tx = contract.functions.submitWeightHash(
        bytes.fromhex(weight_hash[2:])
    ).build_transaction({
        "from":     account.address,
        "nonce":    w3.eth.get_transaction_count(account.address),
        "gas":      200_000,
        "gasPrice": w3.to_wei("20", "gwei"),
    })
    signed = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"[TX] hash(∆w) gửi on-chain: {tx_hash.hex()}")


# ─────────────────────────────────────────────────────────────────────────────
def run_federated_learning(num_rounds=10, num_nodes=3,
                           contract_address=None, abi_path=None,
                           rpc_url="http://127.0.0.1:8545", private_key=None):

    print(f"=== BlockFL: {num_nodes} nodes, {num_rounds} rounds ===\n")

    # Load và chia dữ liệu cho các node (IID split đơn giản)
    node_datasets = load_and_split(num_nodes=num_nodes)

    # Khởi tạo global model
    global_model = compile_model(build_model())
    global_weights = global_model.get_weights()

    history = []

    for rnd in range(1, num_rounds + 1):
        print(f"── Round {rnd}/{num_rounds} ──")
        local_weights_list = []

        # Mỗi node train cục bộ
        for node_id in range(num_nodes):
            X_train, y_train, X_test, y_test = node_datasets[node_id]

            local_model = compile_model(build_model())
            local_model.set_weights(global_weights)          # nhận global weights
            local_w = local_train(local_model, X_train, y_train)

            # Đánh giá
            loss, acc = local_model.evaluate(X_test, y_test, verbose=0)
            print(f"   Node {node_id+1}: loss={loss:.4f}, acc={acc:.4f}")
            local_weights_list.append(local_w)

        # FedAvg
        global_weights = fedavg_aggregate(local_weights_list)
        global_model.set_weights(global_weights)

        # Hash global weights → gửi on-chain
        wh = get_weights_hash(global_weights)
        print(f"   Global hash(∆w): {wh[:20]}...")

        if contract_address and private_key:
            submit_hash_onchain(wh, contract_address, abi_path, rpc_url, private_key)

        # Evaluate global model trên toàn bộ test set
        all_X = np.vstack([d[2] for d in node_datasets])
        all_y = np.hstack([d[3] for d in node_datasets])
        g_loss, g_acc = global_model.evaluate(all_X, all_y, verbose=0)
        print(f"   Global: loss={g_loss:.4f}, acc={g_acc:.4f}\n")
        history.append({"round": rnd, "loss": g_loss, "accuracy": g_acc})

    # Lưu model
    global_model.save("saved_model/blockfl_global")
    with open("saved_model/fl_history.json", "w") as f:
        json.dump(history, f, indent=2)
    print("✅ Saved: saved_model/blockfl_global")
    print("✅ Saved: saved_model/fl_history.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rounds",   type=int, default=10)
    parser.add_argument("--nodes",    type=int, default=3)
    parser.add_argument("--contract", type=str, default=None)
    parser.add_argument("--abi",      type=str, default="../contracts/artifacts/contracts/FLManager.sol/FLManager.json")
    parser.add_argument("--rpc",      type=str, default="http://127.0.0.1:8545")
    parser.add_argument("--key",      type=str, default=None)
    args = parser.parse_args()

    run_federated_learning(
        num_rounds=args.rounds,
        num_nodes=args.nodes,
        contract_address=args.contract,
        abi_path=args.abi,
        rpc_url=args.rpc,
        private_key=args.key,
    )
