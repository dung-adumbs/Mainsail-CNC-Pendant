"""Optional status window; closing it does not stop background transfers."""
import json
import os
import pathlib
import tkinter as tk

folder = pathlib.Path(__file__).parent
config = json.loads((folder / 'config.json').read_text(encoding='utf-8-sig'))
root = tk.Tk()
root.title('CNC Outbox — status')
root.geometry('620x320')
message = tk.StringVar()
tk.Label(root, textvariable=message, justify='left', anchor='w', wraplength=580, padx=18, pady=18).pack(fill='both', expand=True)
row = tk.Frame(root)
row.pack(pady=12)
for text, path in [('Open Outbox', config['outbox']), ('Open Sent', config['sent'])]:
    tk.Button(row, text=text, command=lambda p=path: os.startfile(p)).pack(side='left', padx=8)

def refresh():
    try:
        s = json.loads((folder / 'status.json').read_text(encoding='utf-8'))
        message.set('CNC Outbox v1\n\n' + s['state'] + '\nFiles waiting: ' + str(s['pending']) + '\nLast transferred: ' + (s['last_transfer'] or 'None this run') + '\nUpdated: ' + s['updated'] + '\n\n' + s.get('error', '') + '\n\nClosing this window leaves automatic transfers running.')
    except Exception:
        message.set('Waiting for helper status…')
    root.after(2000, refresh)

refresh()
root.mainloop()
