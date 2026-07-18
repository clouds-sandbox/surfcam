#! /bin/bash
if grep -q "Timeout" ~/devstate; then
	echo "Timeout. Restarting"
	echo "" > ~/devstate;
	~/start.sh
else
	echo "Not restarting."
fi
