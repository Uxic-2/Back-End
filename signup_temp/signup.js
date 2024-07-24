document.addEventListener("DOMContentLoaded", function() {
    // Placeholder arrays to simulate server-side checks
    const existingNicknames = ["user1", "testuser"];
    const existingEmails = ["test@example.com", "hello@example.com"];
    
    window.checkNickname = function() {
        const nickname = document.getElementById("nickname").value;
        const nicknameStatus = document.getElementById("nicknameStatus");

        if (existingNicknames.includes(nickname)) {
            nicknameStatus.textContent = "이미 사용 중인 닉네임입니다.";
            nicknameStatus.style.color = "red";
        } else {
            nicknameStatus.textContent = "사용 가능한 닉네임입니다.";
            nicknameStatus.style.color = "green";
        }
    };

    window.checkEmail = function() {
        const email = document.getElementById("email").value;
        const emailStatus = document.getElementById("emailStatus");

        if (existingEmails.includes(email)) {
            emailStatus.textContent = "이미 사용 중인 이메일입니다.";
            emailStatus.style.color = "red";
        } else {
            emailStatus.textContent = "사용 가능한 이메일입니다.";
            emailStatus.style.color = "green";
        }
    };

    window.verifyPhone = function() {
        const phone1 = document.getElementById("phone1").value;
        const phone2 = document.getElementById("phone2").value;
        const phone3 = document.getElementById("phone3").value;
        const phoneStatus = document.getElementById("phoneStatus");

        const phone = `${phone1}-${phone2}-${phone3}`;
        
        // This is a placeholder for actual phone verification logic
        if (phone === "010-123-4567") {
            phoneStatus.textContent = "인증 완료되었습니다.";
            phoneStatus.style.color = "green";
        } else {
            phoneStatus.textContent = "유효한 전화번호를 입력하세요.";
            phoneStatus.style.color = "red";
        }
    };

    window.validateForm = function() {
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        const passwordError = document.getElementById("passwordError");
        const confirmPasswordError = document.getElementById("confirmPasswordError");

        let valid = true;

        if (password.length < 8 || !/[!@#$%^&*(),.?":{}|<>]/g.test(password)) {
            passwordError.textContent = "비밀번호는 8자 이상이고 특수문자를 포함해야 합니다.";
            valid = false;
        } else {
            passwordError.textContent = "";
        }

        if (password !== confirmPassword) {
            confirmPasswordError.textContent = "비밀번호와 비밀번호 확인이 일치하지 않습니다.";
            valid = false;
        } else {
            confirmPasswordError.textContent = "";
        }

        return valid;
    };

    // Automatically move focus and insert hyphen for phone number
    const phoneInputs = ["phone1", "phone2", "phone3"];
    phoneInputs.forEach((id, index) => {
        document.getElementById(id).addEventListener("input", function() {
            if (this.value.length >= this.maxLength) {
                if (index < phoneInputs.length - 1) {
                    document.getElementById(phoneInputs[index + 1]).focus();
                }
            }
        });
    });
});
