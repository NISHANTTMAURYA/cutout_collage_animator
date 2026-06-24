#!/usr/bin/env python3
import os
import sys
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

class CustomHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        # Handle CORS preflight
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.end_headers()

    def do_POST(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query_params = parse_qs(parsed_url.query)

        if path == '/upload_thumbnail':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            print(f"[Server] Received thumbnail upload request. Data size: {content_length} bytes.")
            
            # Save the incoming raw PNG data to a temporary file
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_thumb:
                temp_thumb.write(post_data)
                temp_thumb_path = temp_thumb.name
                
            thumb_id = os.path.basename(temp_thumb_path)
            response_json = f'{{"thumbnail_id": "{thumb_id}"}}'.encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response_json)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response_json)
            print(f"[Server] Thumbnail saved successfully. Path: {temp_thumb_path}, ID: {thumb_id}")
            return

        elif path == '/convert':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            print(f"[Server] Received conversion request. Data size: {content_length} bytes.")
            
            # Check for thumbnail ID
            thumbnail_id = query_params.get('thumbnail_id', [None])[0]
            thumbnail_path = None
            if thumbnail_id:
                safe_thumb_id = os.path.basename(thumbnail_id)
                thumbnail_path = os.path.join(tempfile.gettempdir(), safe_thumb_id)
                print(f"[Server] Cover art thumbnail requested. ID: {thumbnail_id}, Path: {thumbnail_path}")
            
            # Save the incoming video to a temporary file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_in:
                temp_in.write(post_data)
                temp_in_path = temp_in.name
                
            temp_out_path = temp_in_path + '_converted.mp4'
            
            try:
                # Run ffmpeg to convert to a standard, linearized H.264/AAC MP4
                # If cover art exists, embed it as the cover art stream (attached_pic)
                cmd = [
                    'ffmpeg', '-y',
                    '-i', temp_in_path,
                ]
                
                if thumbnail_path and os.path.exists(thumbnail_path):
                    cmd.extend(['-i', thumbnail_path])
                    cmd.extend([
                        '-map', '0:v',
                        '-map', '0:a?',
                        '-map', '1:v',
                        '-c:v:0', 'libx264',
                        '-profile:v', 'main',
                        '-level:v', '4.0',
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac',
                        '-b:a', '192k',
                        '-c:v:1', 'png',
                        '-disposition:v:1', 'attached_pic',
                    ])
                else:
                    cmd.extend([
                        '-c:v', 'libx264',
                        '-profile:v', 'main',
                        '-level:v', '4.0',
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac',
                        '-b:a', '192k',
                    ])
                    
                cmd.extend([
                    '-movflags', '+faststart',
                    temp_out_path
                ])
                
                print(f"[Server] Running ffmpeg: {' '.join(cmd)}")
                result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                
                if result.returncode != 0:
                    raise Exception(f"ffmpeg error: {result.stderr}")
                
                # Read the converted MP4
                with open(temp_out_path, 'rb') as f:
                    converted_data = f.read()
                    
                # Send response
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', str(len(converted_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(converted_data)
                print(f"[Server] Conversion successful! Sent {len(converted_data)} bytes of optimized MP4 (Cover embedded: {bool(thumbnail_path)}).")
                
            except Exception as e:
                print(f"[Server] Conversion failed: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
                
            finally:
                # Clean up temp files
                if os.path.exists(temp_in_path):
                    try: os.remove(temp_in_path)
                    except: pass
                if os.path.exists(temp_out_path):
                    try: os.remove(temp_out_path)
                    except: pass
                if thumbnail_path and os.path.exists(thumbnail_path):
                    try: os.remove(thumbnail_path)
                    except: pass
        else:
            self.send_response(404)
            self.end_headers()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def run(port=8000):
    # Serve files from the directory of this server script
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)
    server_address = ('', port)
    httpd = HTTPServer(server_address, CustomHandler)
    print(f"Starting custom server with ffmpeg conversion endpoint on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run(port)
