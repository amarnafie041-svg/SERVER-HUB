#!/bin/bash
# ELMODMEN - Server Hub v5 Shell Init (Linux/Bash)

export TERM=xterm-256color
export COLORTERM=truecolor

echo ""
echo -e "\e[32m  ╔════════════════════════════════════════════════════════╗\e[0m"
echo -e "\e[32m  ║\e[0m  \e[1m\e[33mELMODMEN HOST v6 — Server Hub Terminal\e[0m               \e[32m║\e[0m"
echo -e "\e[32m  ╚════════════════════════════════════════════════════════╝\e[0m"
echo ""

prompt_custom() {
    local u="runner"
    local h="serverhub"
    PS1="\[\e[32m\]┌──(\[\e[37m\]$u\[\e[90m\]㉿\[\e[37m\]$h\[\e[32m\])-[\[\e[34m\]\w\[\e[32m\]]\[\e[0m\]"
    PS1+="\n\[\e[32m\]└─\$ \[\e[0m\]"
}
prompt_custom
