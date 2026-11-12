# import pyodbc
# import requests
# from datetime import datetime
# import json
# import os
# import sys
# import time

# requests.packages.urllib3.disable_warnings(
# 	requests.packages.urllib3.exceptions.InsecureRequestWarning
# )

# LOCK_FILE = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "biometric_sync.lock")
# LOCK_STALE_SECONDS = 30 * 60  

# SERVER_NAME = os.getenv("BIO_DB_SERVER", "27.56.152.136,3306") 
# DATABASE_NAME = os.getenv("BIO_DB_NAME", "Attendance")
# DB_USER = os.getenv("BIO_DB_USER", "sa")
# DB_PASSWORD = os.getenv("BIO_DB_PASSWORD", "Biomax@123")

# FRAPPE_URL = os.getenv("FRAPPE_URL", "http://127.0.0.1:8010/app")
# API_KEY = os.getenv("FRAPPE_API_KEY", "ed1c91b0fb9f35d")
# API_SECRET = os.getenv("FRAPPE_API_SECRET", "642c49b9fe2185e")

# DEVICE_MAP = {
# 	1: "SECURITY CABINN - 192.168.1.6",
# 	2: "WORKER 2 - 192.168.1.101",
# 	3: "WORKER 1 - 192.168.1.102",
# 	4: "UNIT 2 MAIN - 192.168.1.10",
# }


# def frappe_headers():
# 	return {
# 		"Authorization": f"token {API_KEY}:{API_SECRET}",
# 		"Content-Type": "application/json",
# 	}


# # def connect():
# # 	connection_string = (
# # 		f"DRIVER={{SQL Server}};SERVER={SERVER_NAME};DATABASE={DATABASE_NAME};"
# # 		f"UID={DB_USER};PWD={DB_PASSWORD};Encrypt=no"
# # 	)
# # 	return pyodbc.connect(connection_string, timeout=30)


# def connect():
#     connection_string = (
#         "DRIVER={ODBC Driver 18 for SQL Server};"
#         f"SERVER={SERVER_NAME};"
#         f"DATABASE={DATABASE_NAME};"
#         f"UID={DB_USER};"
#         f"PWD={DB_PASSWORD};"
#         "Encrypt=no;"
#         "TrustServerCertificate=yes;"
#         "Connection Timeout=30;"
#     )

#     return pyodbc.connect(connection_string, timeout=30)



# def list_devices():
# 	conn = connect()
# 	cursor = conn.cursor()
# 	cursor.execute("SELECT * FROM Devices")
# 	cols = [c[0] for c in cursor.description]
# 	print(cols)
# 	for row in cursor.fetchall():
# 		print(list(row))
# 	conn.close()


# def fetch_and_send_data():
# 	if os.path.exists(LOCK_FILE):
# 		age = time.time() - os.path.getmtime(LOCK_FILE)
# 		if age < LOCK_STALE_SECONDS:
# 			print("Another instance appears to be running (lock file exists). Skipping this run.")
# 			return
# 		print("Stale lock file found. Ignoring it.")
# 	try:
# 		with open(LOCK_FILE, "w") as f:
# 			f.write(str(datetime.now()))
# 	except Exception as e:
# 		print(f"Could not create lock file, continuing anyway: {e}")

# 	try:
# 		_fetch_and_send_data_inner()
# 	finally:
# 		if os.path.exists(LOCK_FILE):
# 			try:
# 				os.remove(LOCK_FILE)
# 			except Exception as e:
# 				print(f"Could not remove lock file: {e}")


# def _fetch_and_send_data_inner():
# 	print("Trigger --> Fetching and sending data...")

# 	try:
# 		conn = connect()
# 		cursor = conn.cursor()
# 	except pyodbc.Error as e:
# 		print(f"Database connection failed: {e}")
# 		return

# 	today = datetime.now()
# 	month_tables = []
# 	for offset in (1, 0):  
# 		month = today.month - offset
# 		year = today.year
# 		if month <= 0:
# 			month += 12
# 			year -= 1
# 		month_tables.append(f"[DeviceLogs_{month}_{year}]")

# 	employee_cache = {}  # biometric id -> Employee name (or None)

# 	for table_name in month_tables:
# 		try:
# 			ensure_synced_column(cursor, conn, table_name, DATABASE_NAME)
# 			cursor.execute(
# 				f"SELECT DeviceLogId, DeviceId, UserId, LogDate, Direction "
# 				f"FROM {table_name} WHERE (Synced IS NULL OR Synced = 0)"
# 			)
# 			logs = cursor.fetchall()
# 		except pyodbc.Error as e:
# 			print(f"Error reading {table_name}: {e}")
# 			continue

# 		print(f"Fetched {len(logs)} unsynced logs from {table_name}.")

# 		for log in logs:
# 			log_id = log.DeviceLogId
# 			device_id = log.DeviceId
# 			biometric_id = str(log.UserId).strip()
# 			timestamp = log.LogDate
# 			log_type = "IN" if str(log.Direction).strip().lower() == "in" else "OUT"

# 			if biometric_id not in employee_cache:
# 				employee_cache[biometric_id] = get_employee_id(biometric_id)
# 			employee = employee_cache[biometric_id]
# 			if not employee:
# 				print(f"Employee with Biometric ID {biometric_id} not found. Skipping log.")
# 				continue

# 			payload = json.dumps({
# 				"employee": employee,
# 				"time": timestamp,
# 				"log_type": log_type,
# 				"device_id": DEVICE_MAP.get(device_id, f"Device {device_id}"),
# 				"custom_checkin_type": "Biometric",
# 			}, default=str)

# 			try:
# 				response = requests.post(
# 					f"{FRAPPE_URL}/api/resource/Employee Checkin",
# 					data=payload, headers=frappe_headers(), verify=False, timeout=30,
# 				)
# 			except requests.RequestException as e:
# 				print(f"Error posting checkin for {biometric_id}: {e}")
# 				continue

		
# 			duplicate = response.status_code != 200 and "same timestamp" in response.text

# 			if response.status_code == 200 or duplicate:
# 				print(f"Log synced for {biometric_id} on device {device_id} ({'duplicate' if duplicate else 'new'})")
# 				cursor.execute(f"UPDATE {table_name} SET Synced = 1 WHERE DeviceLogId = ?", (log_id,))
# 				conn.commit()
# 			else:
# 				print(f"Failed to sync {biometric_id}. Response: {response.text}")

# 	cursor.close()
# 	conn.close()


# def ensure_synced_column(cursor, connection, table_name, database_name):
# 	bare_name = table_name.strip("[]")
# 	cursor.execute(
# 		"""
# 		SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
# 		WHERE TABLE_CATALOG = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'Synced'
# 		""",
# 		(database_name, bare_name),
# 	)
# 	if cursor.fetchone()[0] == 0:
# 		print(f"Adding 'Synced' column to {table_name}...")
# 		cursor.execute(f"ALTER TABLE {table_name} ADD Synced BIT NULL")
# 		connection.commit()


# def get_employee_id(biometric_id):
# 	filters = json.dumps([["attendance_device_id", "=", biometric_id]])
# 	try:
# 		response = requests.get(
# 			f"{FRAPPE_URL}/api/resource/Employee",
# 			params={"filters": filters},
# 			headers=frappe_headers(), verify=False, timeout=30,
# 		)
# 		if response.status_code == 200:
# 			data = response.json().get("data")
# 			if data:
# 				return data[0]["name"]
# 		else:
# 			print(f"Failed to fetch employee for {biometric_id}: {response.text}")
# 	except requests.RequestException as e:
# 		print(f"Error fetching employee: {e}")
# 	return None


# if __name__ == "__main__":
# 	if "--devices" in sys.argv:
# 		list_devices()
# 	else:
# 		fetch_and_send_data()



import os
import sys
import json
import time
import logging
from datetime import datetime

import pyodbc
import requests


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

SERVER_NAME = os.getenv("BIO_DB_SERVER", "27.56.152.136")
SERVER_PORT = os.getenv("BIO_DB_PORT", "1433")

DATABASE_NAME = os.getenv("BIO_DB_NAME", "Attendance")
DB_USER = os.getenv("BIO_DB_USER", "sa")
DB_PASSWORD = os.getenv("BIO_DB_PASSWORD", "")

FRAPPE_URL = os.getenv(
    "FRAPPE_URL",
    "http://127.0.0.1:8010"
).rstrip("/")

# API_KEY = os.getenv("FRAPPE_API_KEY", "")
# API_SECRET = os.getenv("FRAPPE_API_SECRET", "")
API_KEY = os.getenv("FRAPPE_API_KEY", "ed1c91b0fb9f35d")
API_SECRET = os.getenv("FRAPPE_API_SECRET", "642c49b9fe2185e")

LOCK_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "biometric_sync.lock"
)

LOCK_STALE_SECONDS = 30 * 60

DB_TIMEOUT = 15
API_TIMEOUT = 30

DEVICE_MAP = {
    1: "SECURITY CABINN - 192.168.1.6",
    2: "WORKER 2 - 192.168.1.101",
    3: "WORKER 1 - 192.168.1.102",
    4: "UNIT 2 MAIN - 192.168.1.10",
}


# ---------------------------------------------------------
# LOGGING
# ---------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------
# FRAPPE HEADERS
# ---------------------------------------------------------

def frappe_headers():

    if not API_KEY or not API_SECRET:
        raise ValueError(
            "ERPNext API credentials are missing. "
            "Set FRAPPE_API_KEY and FRAPPE_API_SECRET."
        )

    return {
        "Authorization": f"token {API_KEY}:{API_SECRET}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


# ---------------------------------------------------------
# SQL SERVER CONNECTION
# ---------------------------------------------------------

def connect():

    server = f"{SERVER_NAME},{SERVER_PORT}"

    connection_string = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={server};"
        f"DATABASE={DATABASE_NAME};"
        f"UID={DB_USER};"
        f"PWD={DB_PASSWORD};"
        "Encrypt=no;"
        "TrustServerCertificate=yes;"
        f"Connection Timeout={DB_TIMEOUT};"
    )

    logger.info(
        "Connecting to SQL Server %s, database %s",
        server,
        DATABASE_NAME
    )

    return pyodbc.connect(
        connection_string,
        timeout=DB_TIMEOUT
    )


# ---------------------------------------------------------
# TEST DATABASE CONNECTION
# ---------------------------------------------------------

def test_database_connection():

    conn = None

    try:
        conn = connect()
        cursor = conn.cursor()

        cursor.execute("SELECT @@VERSION")

        version = cursor.fetchone()[0]

        logger.info("SQL Server connection successful.")
        logger.info("SQL Server version: %s", version)

        cursor.close()

        return True

    except pyodbc.Error as e:

        logger.error("SQL Server connection failed: %s", e)

        logger.error(
            "Verify SQL Server IP, TCP port, service, "
            "TCP/IP configuration and firewall."
        )

        return False

    finally:

        if conn:
            conn.close()


# ---------------------------------------------------------
# LIST BIOMETRIC DEVICES
# ---------------------------------------------------------

def list_devices():

    conn = None

    try:
        conn = connect()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM Devices")

        columns = [column[0] for column in cursor.description]

        print(columns)

        for row in cursor.fetchall():
            print(list(row))

        cursor.close()

    except pyodbc.Error as e:
        logger.error("Unable to fetch devices: %s", e)

    finally:

        if conn:
            conn.close()


# ---------------------------------------------------------
# ENSURE SYNCED COLUMN EXISTS
# ---------------------------------------------------------

def ensure_synced_column(
    cursor,
    connection,
    table_name,
    database_name
):

    bare_name = table_name.strip("[]")

    cursor.execute(
        """
        SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_CATALOG = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = 'Synced'
        """,
        (database_name, bare_name)
    )

    if cursor.fetchone()[0] == 0:

        logger.info(
            "Adding Synced column to %s",
            table_name
        )

        cursor.execute(
            f"ALTER TABLE {table_name} ADD Synced BIT NULL"
        )

        connection.commit()


# ---------------------------------------------------------
# FETCH EMPLOYEE FROM ERPNEXT
# ---------------------------------------------------------

def get_employee_id(biometric_id):

    filters = json.dumps([
        ["attendance_device_id", "=", biometric_id]
    ])

    try:

        response = requests.get(
            f"{FRAPPE_URL}/api/resource/Employee",
            params={
                "filters": filters,
                "fields": json.dumps(["name"]),
                "limit_page_length": 1,
            },
            headers=frappe_headers(),
            timeout=API_TIMEOUT
        )

        if response.status_code == 200:

            data = response.json().get("data", [])

            if data:
                return data[0]["name"]

            logger.warning(
                "Employee not found for biometric ID %s",
                biometric_id
            )

        else:

            logger.error(
                "Employee API failed for %s: %s",
                biometric_id,
                response.text
            )

    except requests.RequestException as e:

        logger.error(
            "Employee API connection error for %s: %s",
            biometric_id,
            e
        )

    return None


# ---------------------------------------------------------
# CREATE EMPLOYEE CHECKIN
# ---------------------------------------------------------

def create_employee_checkin(
    employee,
    timestamp,
    log_type,
    device_id
):

    payload = {
        "employee": employee,
        "time": timestamp.strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(timestamp, datetime)
        else str(timestamp),
        "log_type": log_type,
        "device_id": DEVICE_MAP.get(
            device_id,
            f"Device {device_id}"
        ),
        "custom_checkin_type": "Biometric",
    }

    try:

        response = requests.post(
            f"{FRAPPE_URL}/api/resource/Employee Checkin",
            json=payload,
            headers=frappe_headers(),
            timeout=API_TIMEOUT
        )

        if response.status_code in (200, 201):

            logger.info(
                "Checkin created: Employee %s, %s",
                employee,
                log_type
            )

            return True

        # Handle duplicate timestamp errors.
        try:
            error_data = response.json()

            error_text = json.dumps(error_data).lower()

        except ValueError:
            error_text = response.text.lower()

        if (
            response.status_code in (400, 409)
            and (
                "same timestamp" in error_text
                or "duplicate" in error_text
            )
        ):

            logger.info(
                "Duplicate checkin ignored: %s",
                employee
            )

            return True

        logger.error(
            "Checkin creation failed for %s. HTTP %s: %s",
            employee,
            response.status_code,
            response.text
        )

        return False

    except requests.RequestException as e:

        logger.error(
            "Checkin API request failed for %s: %s",
            employee,
            e
        )

        return False


# ---------------------------------------------------------
# GET CURRENT AND PREVIOUS MONTH TABLES
# ---------------------------------------------------------

def get_month_tables():

    today = datetime.now()

    tables = []

    for offset in (1, 0):

        month = today.month - offset
        year = today.year

        if month <= 0:
            month += 12
            year -= 1

        tables.append(
            f"[DeviceLogs_{month}_{year}]"
        )

    return tables


# ---------------------------------------------------------
# FETCH AND SEND ATTENDANCE DATA
# ---------------------------------------------------------

def _fetch_and_send_data_inner():

    logger.info("Trigger --> Fetching and sending data...")

    conn = None
    cursor = None

    employee_cache = {}

    try:

        conn = connect()
        cursor = conn.cursor()

    except pyodbc.Error as e:

        logger.error("Database connection failed: %s", e)
        return

    try:

        month_tables = get_month_tables()

        for table_name in month_tables:

            try:

                ensure_synced_column(
                    cursor,
                    conn,
                    table_name,
                    DATABASE_NAME
                )

                cursor.execute(
                    f"""
                    SELECT
                        DeviceLogId,
                        DeviceId,
                        UserId,
                        LogDate,
                        Direction
                    FROM {table_name}
                    WHERE Synced IS NULL OR Synced = 0
                    ORDER BY LogDate
                    """
                )

                logs = cursor.fetchall()

            except pyodbc.Error as e:

                logger.error(
                    "Error reading table %s: %s",
                    table_name,
                    e
                )

                continue

            logger.info(
                "Fetched %s unsynced logs from %s",
                len(logs),
                table_name
            )

            for log in logs:

                log_id = log.DeviceLogId
                device_id = log.DeviceId

                biometric_id = str(log.UserId).strip()

                timestamp = log.LogDate

                direction = str(
                    log.Direction
                ).strip().lower()

                if direction == "in":
                    log_type = "IN"

                elif direction == "out":
                    log_type = "OUT"

                else:

                    logger.warning(
                        "Unknown direction %s for log %s. Skipping.",
                        direction,
                        log_id
                    )

                    continue

                # Employee lookup cache.
                if biometric_id not in employee_cache:

                    employee_cache[biometric_id] = (
                        get_employee_id(biometric_id)
                    )

                employee = employee_cache[biometric_id]

                if not employee:

                    logger.warning(
                        "Employee with biometric ID %s not found.",
                        biometric_id
                    )

                    continue

                # Send attendance to ERPNext.
                success = create_employee_checkin(
                    employee,
                    timestamp,
                    log_type,
                    device_id
                )

                # Mark SQL log synced only after successful
                # creation or confirmed duplicate.
                if success:

                    try:

                        cursor.execute(
                            f"""
                            UPDATE {table_name}
                            SET Synced = 1
                            WHERE DeviceLogId = ?
                            """,
                            (log_id,)
                        )

                        conn.commit()

                    except pyodbc.Error as e:

                        conn.rollback()

                        logger.error(
                            "Failed to update Synced status for log %s: %s",
                            log_id,
                            e
                        )

            logger.info(
                "Finished processing %s",
                table_name
            )

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ---------------------------------------------------------
# LOCK HANDLING
# ---------------------------------------------------------

def fetch_and_send_data():

    if os.path.exists(LOCK_FILE):

        age = time.time() - os.path.getmtime(LOCK_FILE)

        if age < LOCK_STALE_SECONDS:

            logger.warning(
                "Another sync process appears to be running. Skipping."
            )

            return

        logger.warning("Stale lock file detected. Removing it.")

        try:
            os.remove(LOCK_FILE)

        except OSError as e:

            logger.error("Unable to remove stale lock: %s", e)
            return

    try:

        with open(LOCK_FILE, "x") as lock:
            lock.write(str(datetime.now()))

    except FileExistsError:

        logger.warning("Another sync process created the lock.")
        return

    except OSError as e:

        logger.error("Unable to create lock file: %s", e)
        return

    try:

        _fetch_and_send_data_inner()

    except Exception:

        logger.exception("Unexpected biometric synchronization error.")

    finally:

        try:

            if os.path.exists(LOCK_FILE):
                os.remove(LOCK_FILE)

        except OSError as e:

            logger.error("Unable to remove lock file: %s", e)


# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------

if __name__ == "__main__":

    if "--devices" in sys.argv:

        list_devices()

    elif "--test-db" in sys.argv:

        test_database_connection()

    else:

        fetch_and_send_data()
