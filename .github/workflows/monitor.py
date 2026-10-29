import requests

url = "https://file.sagano.linktivity.io/assets/index-754f19b3.js"
res = requests.get(url)
print("=== JS CODE START ===")
print(res.text)
print("=== JS CODE END ===")
