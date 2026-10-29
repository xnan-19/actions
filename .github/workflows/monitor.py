import requests

url = "https://file.sagano.linktivity.io/assets/index-4fb913e2.js"
res = requests.get(url)
print("=== SEAT_JS CODE START ===")
print(res.text)
print("=== SEAT_JS CODE END ===")
