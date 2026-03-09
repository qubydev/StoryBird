import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { FaKey, FaInfoCircle } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { useSettings } from '@/context/SettingsContext';

const parseSessionCookies = (input) => {
    try {
        const cookies = JSON.parse(input);
        if (!Array.isArray(cookies)) throw new Error("Input is not a JSON array");
        const target = cookies.find(c => c.name === "__Secure-next-auth.session-token");
        if (target && target.value) return target.value;
        throw new Error("Session token not found");
    } catch (e) {
        if (input.startsWith("eyJ")) return input;
        throw new Error("Invalid Cookie JSON");
    }
};

export const GlobalSettings = () => {
    const { sessionKey, setSessionKey, instructions, setInstructions } = useSettings();

    const [instructionsOpen, setInstructionsOpen] = useState(false);
    const [sessionOpen, setSessionOpen] = useState(false);

    const [instructionsText, setInstructionsText] = useState(instructions || "");
    const [sessionText, setSessionText] = useState(sessionKey || "");

    const saveInstructions = () => {
        const finalValue = instructionsText.trim();

        if (finalValue) {
            setInstructions(finalValue);
            toast.success("Instructions saved");
        } else {
            setInstructions("");
            toast.success("Instructions cleared");
        }

        setInstructionsOpen(false);
    };

    const saveSession = () => {
        let finalValue = sessionText.trim();

        if (finalValue) {
            try {
                finalValue = parseSessionCookies(finalValue);
            } catch (e) {
                toast.error(e.message || "Invalid input");
                return;
            }

            setSessionKey(finalValue);
            toast.success("Session Key saved");
        } else {
            setSessionKey("");
            toast.success("Session Key cleared");
        }

        setSessionOpen(false);
    };

    let instructionsBtnClass = "h-9 text-sm px-3 border transition-colors ";
    instructionsBtnClass += instructions
        ? "text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
        : "text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200";

    let sessionBtnClass = "h-9 text-sm px-3 border transition-colors ";
    sessionBtnClass += sessionKey
        ? "text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
        : "text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200";

    return (
        <div className="flex items-center gap-2">

            <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className={instructionsBtnClass}>
                        <FaInfoCircle className="mr-2" /> Instructions
                    </Button>
                </DialogTrigger>

                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FaInfoCircle /> Instructions
                        </DialogTitle>
                    </DialogHeader>

                    <div className="py-4">
                        <Textarea
                            value={instructionsText}
                            onChange={(e) => setInstructionsText(e.target.value)}
                            className="h-[300px] break-all font-mono text-xs"
                            placeholder="Enter Instructions..."
                        />
                    </div>

                    <DialogFooter>
                        <Button onClick={saveInstructions}>
                            {instructionsText ? "Save Changes" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>


            <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className={sessionBtnClass}>
                        <FaKey className="mr-2" /> Session Key
                    </Button>
                </DialogTrigger>

                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FaKey /> Session Key
                        </DialogTitle>
                    </DialogHeader>

                    <div className="py-4">
                        <Textarea
                            value={sessionText}
                            onChange={(e) => setSessionText(e.target.value)}
                            className="h-[300px] break-all font-mono text-xs"
                            placeholder="Enter Session Key..."
                        />
                    </div>

                    <DialogFooter>
                        <Button onClick={saveSession}>
                            {sessionText ? "Save Changes" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
};