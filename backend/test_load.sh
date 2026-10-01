#!/bin/bash
set -e
# Register a customer
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/auth/register -H "Content-Type: application/json" -d '{"phone": "+905554443322", "password": "password123", "role": "customer", "name": "Test Customer"}' | jq -r .accessToken)

# Create a load
LOAD_ID=$(curl -s -X POST http://127.0.0.1:8080/api/loads \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Load", "cargoType":"ev_esya", "vehicleType":"panelvan"}' | jq -r .id)

echo "Load ID: $LOAD_ID"

# Create a dummy image
echo "dummy image content" > dummy.jpg

# Upload photo
curl -s -X POST http://127.0.0.1:8080/api/loads/$LOAD_ID/photos \
  -H "Authorization: Bearer $TOKEN" \
  -F "photos=@dummy.jpg;type=image/jpeg" > upload_res.json
cat upload_res.json

# Check if load has photos
curl -s -X GET http://127.0.0.1:8080/api/loads/$LOAD_ID \
  -H "Authorization: Bearer $TOKEN" > load_res.json
cat load_res.json | jq .photoUrls

# Register a driver
DTOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/auth/register -H "Content-Type: application/json" -d '{"phone": "+905554443333", "password": "password123", "role": "driver", "name": "Test Driver"}' | jq -r .accessToken)

# Publish load
curl -s -X POST http://127.0.0.1:8080/api/loads/$LOAD_ID/publish -H "Authorization: Bearer $TOKEN"

# Get nearby jobs
curl -s -X GET http://127.0.0.1:8080/api/drivers/jobs/nearby \
  -H "Authorization: Bearer $DTOKEN" > jobs_res.json

echo "Driver nearby loads:"
cat jobs_res.json | jq '.items[0].photoUrls'

