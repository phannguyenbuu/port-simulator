from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os

app = Flask(__name__)
CORS(app)

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')

@app.route('/api/config', methods=['GET'])
def get_config():
    response_data = {"nodes": None, "paths": None}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                response_data = json.load(f)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
            
    response = jsonify(response_data)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.route('/api/config', methods=['POST'])
def save_config():
    try:
        data = request.json
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Dynamic path resolution for material.json to handle differences between local dev and VPS structures
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
local_path = os.path.join(base_dir, 'public', 'asset', 'material.json')
vps_path = os.path.join(base_dir, 'asset', 'material.json')

if os.path.exists(os.path.dirname(local_path)):
    MATERIAL_FILE = local_path
else:
    MATERIAL_FILE = vps_path

@app.route('/api/material', methods=['GET'])
def get_material():
    response_data = {}
    if os.path.exists(MATERIAL_FILE):
        try:
            with open(MATERIAL_FILE, 'r', encoding='utf-8') as f:
                response_data = json.load(f)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
            
    response = jsonify(response_data)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.route('/api/material', methods=['POST'])
def save_material():
    try:
        data = request.json
        with open(MATERIAL_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5005))
    app.run(port=port, debug=True)
