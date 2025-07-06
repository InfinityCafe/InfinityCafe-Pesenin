# qwen3_mcp_menu.py

# How to run it :
# 1. prepare the environment :  python -m venv venv

# 2. activate environment : 
# 		Mac/Linux: source venv/bin/activate
#     Windows: venv\Scripts\activate

# 3. install all requirements
# 	pip install -r requirements.txt 

# 4. run this script
# 	python qwen3_mcp_menu.py


import os
from qwen_agent.agents import Assistant
from qwen_agent.gui import WebUI
from flask import Flask, request, jsonify
import time  # ⬅️ Tambahkan ini

# Define the agent with Qwen 3 and MCP configuration
def init_agent_service():
	llm_cfg = {
		'model': "qwen3:latest",
		# 'model': "qwen3:1.7b",
		# 'model': "infinity-cafe",
		'model_server': "http://ollama:11434/v1",
		'api_key': 'empty',
		"chat_template_kwargs": {"enable_thinking": False},
        "temperature": 0,
		"top_p": 0.8,
		"top_k": 20,
		"max_tokens": 5000,
		'generate_cfg': {
			'thought_in_content': False,
			# 'fncall_prompt_type': 'nous',
			# 'max_input_tokens': 58000,
			# "temperature": 0,
			# "top_p": 0.8,
			# "top_k": 20,
			# "presence_penalty": 1.5,
            "temperature": 0,
			"top_p": 0.8,
			"top_k": 20,
			"max_tokens": 5000,
    	}
	}
	tools = [{
		'mcpServers': {
			'cafe_menus': {
				'description': 'mcp server that provides Cafe Menu management',
				'url': 'http://menu_service:8001/mcp',
			},
			'cafe_order': {
				'description': 'mcp server that provides Cafe Menu order',
				'url': 'http://order_service:8002/mcp',
			},
			'cafe_kitchen': {
				'description': 'mcp server that provides Cafe kitchen',
				'url': 'http://kitchen_service:8003/mcp',
			}
		}
	}]

	bot = Assistant(
		llm=llm_cfg,
		function_list=tools,
		system_message='/nothink',
		name='MCP-Cafe-Bot',
		description='This bot can answer questions for Cafe Menus, cafe order and cafe kitchen Service'
	)
	return bot

# Test the agent with a query
def test(query='Home many tables are in the database?'):
	bot = init_agent_service()
	messages = [{'role': 'user', 'content': query}]
	for response in bot.run(messages=messages):
		print(response)

# Run a web UI for interactive testing
def app_gui():
	bot = init_agent_service()
	chatbot_config = {
        'prompt': [
            '/no_think',
            '/nothink',
            'enable_thinking=False',
        ]
    }
	WebUI(bot,chatbot_config).run()

# Create Flask app for HTTP API
def create_api():
    app = Flask(__name__)
    bot = init_agent_service()
    
    @app.route('/api/chat', methods=['POST'])
    def chat():
        start_time = time.time()
        
        data = request.json
        if not data or 'message' not in data:
            return jsonify({'error': 'Message is required'}), 400
        
        query = data['message']
        messages = [{'role': 'user', 'content': query}]
        
        # Collect all responses
        responses = []
        for response in bot.run(messages=messages):
            responses.append(response)
        
        # Calculate processing time in milliseconds
        processing_time_ms = round((time.time() - start_time) * 1000)
        
        # Return the final response with timing information
        return jsonify({
            'response': responses[-1] if responses else '',
            'processing_time_ms': processing_time_ms
        })
    
    @app.route('/api/health', methods=['GET'])
    def health_check():
        return jsonify({'status': 'ok'})
    
    return app

# Run the HTTP API server
def run_api(host='0.0.0.0', port=9000):
    app = create_api()
    print(f"Starting HTTP API server on {host}:{port}")
    app.run(host=host, port=port)

if __name__ == '__main__':
	# test()
	# Uncomment to run the web UI
	# app_gui()
    run_api()          # Run the HTTP API server