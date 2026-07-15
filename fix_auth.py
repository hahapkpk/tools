import os

path = r"C:\Users\Administrator\tools-repo\youtube-auto-zh-hans-captions.user.js"
print(f"File exists: {os.path.exists(path)}")
print(f"File size: {os.path.getsize(path)}")

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

print(f"*** count before: {content.count('***')}")
print(f"Bearer count before: {content.count('Bearer')}")

# Fix the 3 template literal cases: *** ${token} -> `Bearer ${token}`
content = content.replace("*** ${token}`", "`Bearer ${token}`")
content = content.replace("*** ${apiKey}`", "`Bearer ${apiKey}`")

# Fix Tencent: standalone *** (no backtick after it) -> authorization
import re
content = re.sub(r'Authorization: \*\*\*(?!\s*`)', 'Authorization: authorization', content)

print(f"*** count after: {content.count('***')}")
print(f"Bearer count after: {content.count('Bearer')}")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("File written successfully")
