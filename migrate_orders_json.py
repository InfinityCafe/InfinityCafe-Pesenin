#!/usr/bin/env python3
import subprocess
import json

def run_sql_command(database, query):
    """Run SQL command using docker exec"""
    cmd = f'docker exec -i pgvector psql -U admin -d {database} -c "{query}"'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.stdout.strip()

def migrate_orders():
    """Migrate orders with notes to kitchen_orders"""
    
    # Get all orders with notes
    query = """
    SELECT DISTINCT order_id 
    FROM order_items 
    WHERE notes IS NOT NULL AND notes != '';
    """
    
    result = run_sql_command('infinity_order_db', query)
    print("Orders with notes found:")
    print(result)
    
    # Extract order IDs
    lines = result.split('\n')
    order_ids = []
    
    for line in lines:
        if 'ORD' in line and '|' in line:
            order_id = line.split('|')[0].strip()
            order_ids.append(order_id)
    
    print(f"\nFound {len(order_ids)} orders with notes")
    
    # Update each order
    for order_id in order_ids:
        # Get items for this order
        items_query = f"""
        SELECT menu_name, quantity, preference, notes 
        FROM order_items 
        WHERE order_id = '{order_id}' AND notes IS NOT NULL AND notes != '';
        """
        
        items_result = run_sql_command('infinity_order_db', items_query)
        print(f"\nItems for order {order_id}:")
        print(items_result)
        
        # Parse items
        items = []
        item_lines = items_result.split('\n')
        
        for line in item_lines[3:-1]:  # Skip header and footer
            if '|' in line:
                parts = [p.strip() for p in line.split('|')]
                if len(parts) >= 4:
                    items.append({
                        'menu_name': parts[0],
                        'quantity': int(parts[1]),
                        'preference': parts[2],
                        'notes': parts[3]
                    })
        
        if items:
            # Create JSON and update kitchen_orders
            orders_json = json.dumps(items)
            update_query = f"UPDATE kitchen_orders SET orders_json = '{orders_json}' WHERE order_id = '{order_id}';"
            
            update_result = run_sql_command('infinity_kitchen_db', update_query)
            print(f"Updated order {order_id}: {update_result}")
            print(f"JSON: {orders_json}")

if __name__ == "__main__":
    print("Starting migration of orders_json...")
    migrate_orders()
    print("Migration completed!") 