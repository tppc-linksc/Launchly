package com.launchly.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GlobalExceptionHandlerTest {

    @Test
    void shouldPreserveStatusCodeAndReasonForResponseStatusException() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        ResponseStatusException exception = new ResponseStatusException(HttpStatus.CONFLICT, "cannot delete");
        ResponseEntity<Map<String, String>> response = handler.responseStatus(exception);

        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertEquals("cannot delete", response.getBody().get("message"));
    }
}
