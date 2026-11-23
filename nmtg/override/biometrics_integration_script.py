import pyodbc
import requests
from datetime import datetime
import json
import os
import sys
import time

requests.packages.urllib3.disable_warnings(
	requests.packages.urllib3.exceptions.InsecureRequestWarning
)


SERVER_NAME = os.getenv("BIO_DB_SERVER", "27.56.152.136,1433") 
DATABASE_NAME = os.getenv("BIO_DB_NAME", "Attendance")
DB_USER = os.getenv("BIO_DB_USER", "sa")
DB_PASSWORD = os.getenv("BIO_DB_PASSWORD", "admin@12345")

FRAPPE_URL = os.getenv("FRAPPE_URL", "https://nmtg-uat.frappe.cloud")
API_KEY = os.getenv("FRAPPE_API_KEY", "b92c32306009aae")
API_SECRET = os.getenv("FRAPPE_API_SECRET", "ee559ea866e75c6")

DEVICE_MAP = {
	1: "SECURITY CABINN - 192.168.1.6",
	2: "WORKER 2 - 192.168.1.101",
	3: "WORKER 1 - 192.168.1.102",
	4: "UNIT 2 MAIN - 192.168.1.10",
}


def frappe_headers():
	return {
		"Authorization": f"token {API_KEY}:{API_SECRET}",
		"Content-Type": "application/json",
	}


def get_driver():
	"""Pick whichever SQL Server ODBC driver is installed on this PC."""
	preferred = [
		"ODBC Driver 18 for SQL Server",
		"ODBC Driver 17 for SQL Server",
		"ODBC Driver 13 for SQL Server",
		"SQL Server Native Client 11.0",
		"SQL Server",  # built into every Windows PC
	]
	installed = pyodbc.drivers()
	for d in preferred:
		if d in installed:
			return d
	raise RuntimeError(f"No SQL Server ODBC driver found. Installed drivers: {installed}")


def connect():
	driver = get_driver()
	print(f"Using ODBC driver: {driver}")
	connection_string = (
		f"DRIVER={{{driver}}};"
		f"SERVER={SERVER_NAME};"
		f"DATABASE={DATABASE_NAME};"
		f"UID={DB_USER};"
		f"PWD={DB_PASSWORD};"
		"Encrypt=no;"
	)
	# This option only exists on the newer "ODBC Driver xx" versions
	if driver.startswith("ODBC Driver"):
		connection_string += "TrustServerCertificate=yes;"
	return pyodbc.connect(connection_string, timeout=30)


def list_devices():
	conn = connect()
	cursor = conn.cursor()
	cursor.execute("SELECT * FROM Devices")
	cols = [c[0] for c in cursor.description]
	print(cols)
	for row in cursor.fetchall():
		print(list(row))
	conn.close()


def fetch_and_send_data():
	print("Trigger --> Fetching and sending data...")

	try:
		conn = connect()
		cursor = conn.cursor()
	except (pyodbc.Error, RuntimeError) as e:
		print(f"Database connection failed: {e}")
		return

	today = datetime.now()
	month_tables = []
	for offset in (1, 0):  
		month = today.month - offset
		year = today.year
		if month <= 0:
			month += 12
			year -= 1
		month_tables.append(f"[DeviceLogs_{month}_{year}]")

	employee_cache = {}  # biometric id -> Employee name (or None)

	for table_name in month_tables:
		try:
			ensure_synced_column(cursor, conn, table_name, DATABASE_NAME)
			cursor.execute(
				f"SELECT DeviceLogId, DeviceId, UserId, LogDate, Direction "
				f"FROM {table_name} WHERE (Synced IS NULL OR Synced = 0)"
			)
			logs = cursor.fetchall()
		except pyodbc.Error as e:
			print(f"Error reading {table_name}: {e}")
			continue

		print(f"Fetched {len(logs)} unsynced logs from {table_name}.")

		for log in logs:
			log_id = log.DeviceLogId
			device_id = log.DeviceId
			biometric_id = str(log.UserId).strip()
			timestamp = log.LogDate
			log_type = "IN" if str(log.Direction).strip().lower() == "in" else "OUT"

			if biometric_id not in employee_cache:
				employee_cache[biometric_id] = get_employee_id(biometric_id)
			employee = employee_cache[biometric_id]
			if not employee:
				print(f"Employee with Biometric ID {biometric_id} not found. Skipping log.")
				continue

			payload = json.dumps({
				"employee": employee,
				"time": timestamp,
				"log_type": log_type,
				"device_id": DEVICE_MAP.get(device_id, f"Device {device_id}"),
				"custom_checkin_type": "Biometric",
			}, default=str)

			try:
				response = requests.post(
					f"{FRAPPE_URL}/api/resource/Employee Checkin",
					data=payload, headers=frappe_headers(), verify=False, timeout=30,
				)
			except requests.RequestException as e:
				print(f"Error posting checkin for {biometric_id}: {e}")
				continue

		
			duplicate = response.status_code != 200 and "same timestamp" in response.text

			if response.status_code == 200 or duplicate:
				print(f"Log synced for {biometric_id} on device {device_id} ({'duplicate' if duplicate else 'new'})")
				cursor.execute(f"UPDATE {table_name} SET Synced = 1 WHERE DeviceLogId = ?", (log_id,))
				conn.commit()
			else:
				print(f"Failed to sync {biometric_id}. Response: {response.text}")

	cursor.close()
	conn.close()


def ensure_synced_column(cursor, connection, table_name, database_name):
	bare_name = table_name.strip("[]")
	cursor.execute(
		"""
		SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_CATALOG = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'Synced'
		""",
		(database_name, bare_name),
	)
	if cursor.fetchone()[0] == 0:
		print(f"Adding 'Synced' column to {table_name}...")
		cursor.execute(f"ALTER TABLE {table_name} ADD Synced BIT NULL")
		connection.commit()


def get_employee_id(biometric_id):
	filters = json.dumps([["attendance_device_id", "=", biometric_id]])
	try:
		response = requests.get(
			f"{FRAPPE_URL}/api/resource/Employee",
			params={"filters": filters},
			headers=frappe_headers(), verify=False, timeout=30,
		)
		if response.status_code == 200:
			data = response.json().get("data")
			if data:
				return data[0]["name"]
		else:
			print(f"Failed to fetch employee for {biometric_id}: {response.text}")
	except requests.RequestException as e:
		print(f"Error fetching employee: {e}")
	return None


if __name__ == "__main__":
	if "--devices" in sys.argv:
		list_devices()
	else:
		fetch_and_send_data()
